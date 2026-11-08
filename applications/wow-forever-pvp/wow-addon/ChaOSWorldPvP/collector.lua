local ns = ChaOSWorldPvP
local frame = CreateFrame("Frame")
local db, profile, baseline, lastLocation, exportFrame
local honorBaseline
local pendingExport
local recentKills = {}
local isDead, elapsed = false, 0
local pendingDeath, lastFatalTimestamp
local recapRetryDelays = { 0.3, 0.7, 1 }

-- Secret values are discarded before any comparison, conversion or persistence.
local function read(fn, ...)
    if type(fn) ~= "function" then return nil end
    local ok, value = pcall(fn, ...)
    if not ok then return nil end
    if issecretvalue and issecretvalue(value) then return nil end
    return value
end
local function number(value)
    if type(value) == "number" and value == value and value >= 0 and value < math.huge then return value end
end
local function text(value)
    if type(value) == "string" and #value > 0 then return value end
end
local function honorPoints()
    -- CurrencyConsts.HONOR_CURRENCY_ID in the Forever API, not lifetime HK.
    return read(function()
        local currencyId = Constants and Constants.CurrencyConsts and Constants.CurrencyConsts.HONOR_CURRENCY_ID or 1792
        local info = read(C_CurrencyInfo and C_CurrencyInfo.GetCurrencyInfo, currencyId)
        local quantity = info and number(read(function() return info.quantity end))
        if quantity and quantity % 1 == 0 and quantity <= 100000000 then return quantity end
    end)
end
local function now() return read(GetServerTime) or time() end
local function nextId()
    db.sequence = db.sequence + 1
    return tostring(db.sequence)
end
local function context()
    -- The second return value is read inside a protected call as well.
    return read(function()
        local inside, kind = IsInInstance()
        if issecretvalue and (issecretvalue(inside) or issecretvalue(kind)) then return "unknown" end
        if inside == false and kind == "none" then return "world" end
        if kind == "pvp" or kind == "arena" then return kind end
        if inside == true then return "instance" end
        return "unknown"
    end) or "unknown"
end
local function position()
    if not C_Map then return nil end
    local mapId = number(read(C_Map.GetBestMapForUnit, "player"))
    if not mapId then return nil end
    local result = { mapId = mapId, at = now(), zone = text(read(GetRealZoneText)) }
    local coordinates = read(function()
        local point = C_Map.GetPlayerMapPosition(mapId, "player")
        if not point then return nil end
        local x, y = point:GetXY()
        if issecretvalue and (issecretvalue(x) or issecretvalue(y)) then return nil end
        if number(x) and number(y) and x <= 1 and y <= 1 then return { x = x, y = y } end
    end)
    if coordinates then result.x, result.y = coordinates.x, coordinates.y end
    return result
end
local function append(kind, item, limit)
    profile[kind][#profile[kind] + 1] = item
    if #profile[kind] > limit then
        table.remove(profile[kind], 1)
        profile.dropped = (profile.dropped or 0) + 1
    end
end
local function event(kind, amount, eventContext, location)
    local item = {
        id = nextId(), at = now(), type = kind, amount = amount or 0,
        context = eventContext or context(), cause = "unknown", location = location,
    }
    append("events", item, 5000)
    return item
end
local function observeKill(attackerValue, targetValue)
    -- PARTY_KILL is separate from the restricted combat-log stream. Its
    -- identities can still be secret: discard them before comparing anything.
    local attacker = text(read(function() return attackerValue end))
    local target = text(read(function() return targetValue end))
    local player = text(read(UnitGUID, "player"))
    local pet = text(read(UnitGUID, "pet"))
    if not attacker or not target or not player or target == player
        or not target:match("^Player%-") then return end
    if attacker ~= player and (not pet or attacker ~= pet) then return end
    local at = now()
    for guid, previous in pairs(recentKills) do
        if at - previous > 1 then recentKills[guid] = nil end
    end
    if recentKills[target] then return end
    recentKills[target] = at
    local victim = read(function()
        if type(UnitNameFromGUID) ~= "function" then return nil end
        local name, realm = UnitNameFromGUID(target)
        name = text(read(function() return name end))
        realm = text(read(function() return realm end))
        if not name or name == UNKNOWNOBJECT then return nil end
        if realm then name = name .. "-" .. realm end
        if #name <= 160 and not name:find("[%z\1-\31]") then return name end
    end)
    local item = event("player-kill", 0, context(), position())
    item.victim = victim
    item.byPet = attacker == pet or nil
end
local function classifyHit(hit)
    local kind = read(function() return hit.event end)
    if kind == "ENVIRONMENTAL_DAMAGE" then return "environment" end
    local guid = text(read(function() return hit.sourceGUID end))
    local flags = number(read(function() return hit.sourceFlags end))
    local sourceType = guid and guid:match("^([^-]+)-")
    local controlledByPlayer = flags and math.floor(flags / 0x100) % 2 == 1
    local controlledByNPC = flags and math.floor(flags / 0x200) % 2 == 1
    local playerGUID = text(read(UnitGUID, "player"))
    local cause
    if (guid and guid == playerGUID) or (controlledByPlayer and flags % 2 == 1) then cause = "self"
    elseif sourceType == "Player" or controlledByPlayer then cause = "pvp"
    elseif sourceType == "Creature" or sourceType == "Vehicle" or controlledByNPC then cause = "pve" end
    if not cause then return nil end
    local source = text(read(function() return hit.sourceName end))
    if source and (#source > 160 or source:find("[%z\1-\31]")) then source = nil end
    return cause, source
end
local function recapAPI()
    return C_DeathRecap and C_DeathRecap.GetRecapEvents or DeathRecap_GetEvents
end
local function fatalHit(death)
    local entries = read(recapAPI())
    if type(entries) ~= "table" then return nil end
    local hit, latest
    for _, entry in ipairs(entries) do
        if (not issecretvalue or not issecretvalue(entry)) and type(entry) == "table" then
            local stamp = number(read(function() return entry.timestamp end))
            local overkill = number(read(function() return entry.overkill end))
            if overkill and stamp and math.abs(math.floor(stamp) - death.at) <= 1
                and stamp > (lastFatalTimestamp or 0) and (not latest or stamp > latest) then
                hit, latest = entry, stamp
            end
        end
    end
    if not hit then return nil end

    local cause, source = classifyHit(hit)
    return latest, cause, source
end
local function resolveDeath(death, attempt)
    if pendingDeath ~= death then return end
    -- The client can publish the recap after PLAYER_DEAD.
    local stamp, cause, source = fatalHit(death)
    if cause then
        death.cause, death.source = cause, source
        lastFatalTimestamp = stamp
    elseif recapRetryDelays[attempt + 1] and C_Timer and C_Timer.After then
        C_Timer.After(recapRetryDelays[attempt + 1], function() resolveDeath(death, attempt + 1) end)
        return
    end
    pendingDeath = nil
end
local function tooltipText(value)
    value = text(value)
    if not value then return nil end
    value = value:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "")
        :gsub("|T.-|t", ""):gsub("|A.-|a", ""):gsub("[%z\1-\31]", " ")
        :match("^%s*(.-)%s*$")
    if #value <= 300 then return text(value) end
end
local function equippedTooltip(slot)
    return read(function()
        local info = read(C_TooltipInfo and C_TooltipInfo.GetInventoryItem, "player", slot)
        if type(info) ~= "table" then return nil end
        local lines = read(function() return info.lines end)
        if type(lines) ~= "table" then return nil end
        local result = ns.Array()
        for index = 2, #lines do
            local line = read(function() return lines[index] end)
            if type(line) == "table" then
                local left = tooltipText(read(function() return line.leftText end))
                local right = tooltipText(read(function() return line.rightText end))
                local color = read(function() return line.leftColor end)
                local effect = read(function()
                    return color and color.g > color.r + 0.3 and color.g > color.b + 0.3
                end)
                if left then
                    result[#result + 1] = { text = left, right = right, effect = effect or nil }
                end
                if #result >= 20 then break end
            end
        end
        if #result > 0 then return result end
    end)
end
local function transmogItem(slot, itemId)
    return read(function()
        if not C_Transmog or not Enum or not Enum.TransmogType or not Enum.TransmogModification then return nil end
        local info = read(C_Transmog.GetSlotVisualInfo, {
            slotID = slot, type = Enum.TransmogType.Appearance,
            modification = Enum.TransmogModification.Main,
        })
        if type(info) ~= "table" then return nil end
        -- Pending choices belong to the NPC preview, not the equipped appearance.
        local source = number(read(function() return info.appliedSourceID end))
        if not source then return nil end
        if source == 0 then return itemId end
        local visual = number(read(function() return info.appliedVisualID end))
        if visual and read(C_TransmogCollection and C_TransmogCollection.IsAppearanceHiddenVisual, visual) == true then
            return 0
        end
        local applied = number(read(C_Transmog.GetItemIDForSource, source))
        if applied and applied > 0 and applied % 1 == 0 and applied <= 1000000000 then return applied end
    end)
end
local function equipment()
    local items = ns.Array()
    for slot = 1, 19 do
        local itemId = number(read(GetInventoryItemID, "player", slot))
        if itemId then
            local icon = number(read(GetInventoryItemTexture, "player", slot))
            local quality = number(read(C_Item and C_Item.GetItemQualityByID, itemId))
            items[#items + 1] = {
                slot = slot, itemId = itemId, link = text(read(GetInventoryItemLink, "player", slot)),
                transmogItemId = transmogItem(slot, itemId),
                icon = icon and icon > 0 and icon or nil,
                quality = quality and quality <= 8 and quality or nil,
            }
        end
    end
    return items
end
local function playerRaceId()
    return number(read(function()
        local _, _, id = UnitRace("player")
        return id
    end))
end
local barberSession
local function captureAppearance(confirmed)
    if not barberSession or not C_BarberShop then return end
    if not confirmed and read(C_BarberShop.HasAnyChanges) ~= false then return end
    if read(C_BarberShop.IsViewingAlteredForm) == true or read(C_BarberShop.GetViewingChrModel) then return end
    local raceId = playerRaceId()
    local sex = read(function()
        local data = read(C_BarberShop.GetCurrentCharacterData)
        if not data then return nil end
        local value = read(function() return data.sex end)
        if value == 0 or value == 1 then return value + 2 end
    end)
    if not raceId or raceId < 1 or raceId > 10000 or not sex then return end
    if not confirmed and sex ~= read(UnitSex, "player") then return end
    local choices = read(function()
        local categories = read(C_BarberShop.GetAvailableCustomizations)
        if type(categories) ~= "table" then return nil end
        local result, seen = ns.Array(), {}
        for _, category in ipairs(categories) do
            for _, option in ipairs(category.options) do
                local index = option.currentChoiceIndex
                local selected = index and option.choices[index]
                if selected then
                    local optionId, choiceId = number(option.id), number(selected.id)
                    if not optionId or optionId < 1 or optionId > 999999999 or optionId % 1 ~= 0
                        or not choiceId or choiceId < 1 or choiceId > 999999999 or choiceId % 1 ~= 0 then return nil end
                    if seen[optionId] and seen[optionId] ~= choiceId then return nil end
                    if not seen[optionId] then
                        seen[optionId] = choiceId
                        result[#result + 1] = { optionId = optionId, choiceId = choiceId }
                    end
                end
            end
        end
        if #result > 0 and #result <= 64 then return result end
    end)
    if not choices then return end
    profile.appearance = { at = now(), raceId = raceId, sex = sex, choices = choices }
    barberSession.captured = true
    return true
end
local function snapshot()
    local character = profile.character
    character.level = number(read(UnitLevel, "player"))
    character.race = text(read(UnitRace, "player")) or character.race
    local raceId = playerRaceId()
    if raceId and raceId > 0 then character.raceId = raceId end
    local sex = number(read(UnitSex, "player"))
    if sex == 2 or sex == 3 then character.sex = sex end
    local appearance = profile.appearance
    character.appearance = nil
    if appearance and appearance.raceId == character.raceId and appearance.sex == character.sex then
        ns.Array(appearance.choices)
        character.appearance = appearance
    end
    append("snapshots", {
        id = nextId(), at = now(), lifetimeHK = number(read(GetPVPLifetimeStats)),
        playedSeconds = profile.played and profile.played.seconds,
        playedAt = profile.played and profile.played.at,
        honorPoints = honorPoints(),
        guild = text(read(GetGuildInfo, "player")), equipment = equipment(),
    }, 300)
end
local function sample()
    local at, currentContext = now(), context()
    local current = number(read(GetPVPLifetimeStats))
    local location = position()
    if current and baseline and baseline.value then
        local difference = current - baseline.value
        if difference > 0 then
            -- A delayed counter update cannot be assigned to an unobserved zone or context.
            local isContinuous = at - baseline.at <= 5 and currentContext == baseline.context
            local isSameMap = location and baseline.mapId == location.mapId
            event("honor-gain", difference, isContinuous and currentContext or "unknown",
                isContinuous and isSameMap and location or nil)
        elseif difference < 0 then event("counter-reset", 0, currentContext) end
    end
    baseline = { value = current, at = at, context = currentContext, mapId = location and location.mapId }
    local honor = honorPoints()
    if honor ~= nil and honorBaseline and honorBaseline.value ~= nil then
        local difference = honor - honorBaseline.value
        if difference ~= 0 then
            local isContinuous = at - honorBaseline.at <= 5 and currentContext == honorBaseline.context
            event(difference > 0 and "honor-points-gain" or "honor-points-loss", math.abs(difference),
                isContinuous and currentContext or "unknown")
        end
    end
    honorBaseline = { value = honor, at = at, context = currentContext }
    -- Do not replace the death position with the spirit healer's position.
    if location and not isDead then
        if location.x then lastLocation = location
        elseif lastLocation and lastLocation.mapId ~= location.mapId then lastLocation = nil end
    end
end
local function initialize()
    ChaOSWorldPvPDB = ChaOSWorldPvPDB or { version = 1, sequence = 0, profiles = {} }
    db = ChaOSWorldPvPDB
    if db.version ~= 1 then
        print("ChaOS PvP: unsupported saved data version.")
        db = nil
        return
    end
    db.sourceId = db.sourceId or (tostring(now()) .. "-" .. tostring(math.random(100000, 999999999)))
    local name = text(read(GetUnitName, "player", true)) or text(read(UnitName, "player"))
    local realm = text(read(GetRealmName))
    if not name or not realm then db = nil; return end
    local region = read(GetCurrentRegion)
    region = number(region) and tostring(region) or "unknown"
    local key = name .. "@" .. realm .. "@" .. region
    db.profiles[key] = db.profiles[key] or { snapshots = {}, events = {}, ruleset = "unknown" }
    profile = db.profiles[key]
    -- CAMWOW layer numbers are not server identities. Older exports left the
    -- ruleset unknown even though the client realm label already included it.
    if profile.ruleset == "unknown" then
        local label = realm:lower()
        if label:match("%f[%a]pvp%s*$") then profile.ruleset = "pvp"
        elseif label:match("%f[%a]pve%s*$") then profile.ruleset = "pve" end
    end
    profile.character = { name = name, realm = realm, region = region, ruleset = profile.ruleset,
        class = text(read(UnitClass, "player")), faction = text(read(UnitFactionGroup, "player")) }
    -- Session boundaries never infer gains from the offline interval.
    baseline, lastLocation, pendingDeath, lastFatalTimestamp = nil, nil, nil, nil
    honorBaseline = nil
    recentKills = {}
    barberSession = nil
    pendingExport = nil
    isDead = read(UnitIsDeadOrGhost, "player") == true
    sample()
    snapshot()
    event("session-start")
    read(RequestTimePlayed)
end
local function showExport()
    captureAppearance()
    snapshot()
    local currentEquipment = profile.snapshots[#profile.snapshots].equipment
    if not exportFrame then
        exportFrame = CreateFrame("Frame", "ChaOSWorldPvPExport", UIParent, "BasicFrameTemplateWithInset")
        exportFrame:SetSize(650, 430)
        exportFrame:SetPoint("CENTER")
        exportFrame.TitleText:SetText("ChaOS PvP - Ctrl+A, Ctrl+C")
        local scroll = CreateFrame("ScrollFrame", nil, exportFrame, "UIPanelScrollFrameTemplate")
        scroll:SetPoint("TOPLEFT", 16, -40)
        scroll:SetPoint("BOTTOMRIGHT", -34, 20)
        local edit = CreateFrame("EditBox", nil, scroll)
        edit:SetMultiLine(true)
        edit:SetFontObject(ChatFontNormal)
        edit:SetWidth(580)
        edit:SetAutoFocus(false)
        edit:SetScript("OnEscapePressed", function() exportFrame:Hide() end)
        scroll:SetScrollChild(edit)
        exportFrame.edit = edit
    end
    -- SavedVariables do not preserve metatables; mark arrays again before encoding.
    for _, item in ipairs(profile.snapshots) do ns.Array(item.equipment) end
    local payload = {
        format = "chaos-world-pvp", version = 1, sourceId = db.sourceId,
        addonVersion = ns.version, build = read(function()
            local version, build = GetBuildInfo()
            return tostring(version) .. "/" .. tostring(build)
        end) or "unknown",
        exportedAt = now(), character = profile.character,
        snapshots = ns.Array(profile.snapshots), events = ns.Array(profile.events),
    }
    exportFrame:Show()
    -- Only the current equipment needs full tooltips. Keep past snapshots compact.
    for _, item in ipairs(currentEquipment) do item.tooltip = equippedTooltip(item.slot) end
    payload.snapshots, payload.equipmentSets = ns.CompactSnapshots(profile.snapshots)
    local encoded = ns.Encode(payload)
    for _, item in ipairs(currentEquipment) do item.tooltip = nil end
    exportFrame.edit:SetText(encoded)
    exportFrame.edit:SetFocus()
    exportFrame.edit:HighlightText()
    if profile.dropped then print("ChaOS PvP: local retention limit reached; older observations omitted: " .. profile.dropped) end
end
local function requestExport()
    sample()
    local request = {}
    pendingExport = request
    read(RequestTimePlayed)
    -- TIME_PLAYED_MSG is asynchronous. Keep exporting possible if the API is
    -- absent or the server does not reply, using the last dated measurement.
    local function finish()
        if pendingExport ~= request then return end
        pendingExport = nil
        showExport()
    end
    if C_Timer and C_Timer.After then C_Timer.After(2, finish) else finish() end
end
frame:SetScript("OnEvent", function(_, name, ...)
    if name == "PLAYER_LOGIN" then initialize(); return end
    if not profile or not db then return end
    local success = ...
    if name == "TIME_PLAYED_MSG" then
        local seconds = number(read(function() return success end))
        if seconds and seconds % 1 == 0 and seconds <= 4102444800 then
            profile.played = { seconds = seconds, at = now() }
            if pendingExport then pendingExport = nil; showExport()
            else snapshot() end
        end
    elseif name == "PLAYER_GUILD_UPDATE" then
        if read(function() return success end) == "player" then sample(); snapshot() end
    elseif name == "PARTY_KILL" then
        observeKill(...)
    elseif name == "CURRENCY_DISPLAY_UPDATE" then
        sample()
    elseif name == "BARBER_SHOP_OPEN" then
        local session = {}
        barberSession = session
        if not captureAppearance() and C_Timer and C_Timer.After then
            C_Timer.After(0, function()
                if barberSession == session then captureAppearance() end
            end)
        end
    elseif name == "BARBER_SHOP_CLOSE" then
        barberSession = nil
    elseif name == "BARBER_SHOP_FORCE_CUSTOMIZATIONS_UPDATE" then
        if barberSession and not barberSession.captured then captureAppearance() end
    elseif name == "BARBER_SHOP_RESULT" then
        if read(function() return success end) == true then captureAppearance(true) end
    elseif name == "PLAYER_DEAD" and not isDead then
        isDead = true
        local location = position()
        if (not location or not location.x) and lastLocation
            and (not location or location.mapId == lastLocation.mapId) then location = lastLocation end
        if location and now() - location.at > 10 then location = nil end
        local death = event("death", 0, context(), location)
        pendingDeath = nil
        pendingDeath = death
        resolveDeath(death, 0)
    elseif name == "PLAYER_ALIVE" or name == "PLAYER_UNGHOST" then
        isDead = read(UnitIsDeadOrGhost, "player") == true
    elseif name == "PLAYER_LOGOUT" then
        if pendingDeath then resolveDeath(pendingDeath, #recapRetryDelays) end
        sample(); snapshot(); event("session-end")
    end
end)
for _, name in ipairs({ "PLAYER_LOGIN", "PLAYER_DEAD", "PLAYER_ALIVE", "PLAYER_UNGHOST", "PLAYER_LOGOUT" }) do
    frame:RegisterEvent(name)
end
for _, name in ipairs({ "BARBER_SHOP_OPEN", "BARBER_SHOP_CLOSE", "BARBER_SHOP_RESULT", "BARBER_SHOP_FORCE_CUSTOMIZATIONS_UPDATE" }) do
    pcall(frame.RegisterEvent, frame, name)
end
frame:RegisterEvent("CURRENCY_DISPLAY_UPDATE")
frame:RegisterEvent("PARTY_KILL")
frame:RegisterEvent("TIME_PLAYED_MSG")
frame:RegisterEvent("PLAYER_GUILD_UPDATE")
-- Forever blocks combat-log event registration. pcall cannot prevent the
-- protected-action warning, so use the death recap without probing this event.
frame:SetScript("OnUpdate", function(_, delta)
    elapsed = elapsed + delta
    if elapsed < 2 or not db or not profile then return end
    elapsed = 0
    sample()
end)
SLASH_CHAOSWORLDPVP1 = "/cvp"
local function showHonor()
    sample()
    local gained, lost = 0, 0
    for _, item in ipairs(profile.events) do
        if item.type == "honor-points-gain" then gained = gained + item.amount end
        if item.type == "honor-points-loss" then lost = lost + item.amount end
    end
    local points = honorPoints()
    print("ChaOS PvP: honneur disponible : " .. (points ~= nil and tostring(points) or "illisible")
        .. "; gains observes : " .. gained .. "; baisses observees : " .. lost .. " (historique local conserve).")
end
SlashCmdList.CHAOSWORLDPVP = function(message)
    if not profile or not db then print("ChaOS PvP: collector unavailable."); return end
    if message == "export" then
        if pendingDeath then print("ChaOS PvP: death recap pending. Try /cvp export in two seconds."); return end
        requestExport()
    elseif message == "honor" then
        showHonor()
    elseif message == "appearance" then
        if captureAppearance() then print("ChaOS PvP: appearance captured. Use /cvp export.")
        elseif profile.appearance then print("ChaOS PvP: saved appearance available. Reopen the barber shop to refresh it.")
        else print("ChaOS PvP: open the barber shop to capture your appearance without changing it.") end
    elseif message == "status" then
        showHonor()
        local appearance = profile.appearance
        print("ChaOS PvP: appearance choices captured: " .. tostring(appearance and #appearance.choices or 0))
        print("ChaOS PvP " .. ns.version .. ": " .. #profile.events .. " events, " .. #profile.snapshots .. " snapshots.")
        print("HK readable: " .. tostring(number(read(GetPVPLifetimeStats)) ~= nil) .. "; map readable: " .. tostring(position() ~= nil))
        print("Death recap API: " .. tostring(type(recapAPI()) == "function") .. "; combat log: disabled (Forever restriction)")
        print("Ruleset: " .. profile.ruleset .. "; dropped: " .. tostring(profile.dropped or 0))
    else print("ChaOS PvP: /cvp export | /cvp honor | /cvp appearance | /cvp status.") end
end
