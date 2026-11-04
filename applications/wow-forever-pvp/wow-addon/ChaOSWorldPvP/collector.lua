local ns = ChaOSWorldPvP
local frame = CreateFrame("Frame")
local db, profile, baseline, lastLocation, exportFrame
local isDead, elapsed = false, 0

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
    append("events", {
        id = nextId(), at = now(), type = kind, amount = amount or 0,
        context = eventContext or context(), cause = "unknown", location = location,
    }, 5000)
end
local function equipment()
    local items = ns.Array()
    for slot = 1, 19 do
        local itemId = number(read(GetInventoryItemID, "player", slot))
        if itemId then
            items[#items + 1] = { slot = slot, itemId = itemId, link = text(read(GetInventoryItemLink, "player", slot)) }
        end
    end
    return items
end
local function snapshot()
    profile.character.level = number(read(UnitLevel, "player"))
    append("snapshots", {
        id = nextId(), at = now(), lifetimeHK = number(read(GetPVPLifetimeStats)),
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
    profile.character = { name = name, realm = realm, region = region, ruleset = profile.ruleset,
        class = text(read(UnitClass, "player")), race = text(read(UnitRace, "player")),
        faction = text(read(UnitFactionGroup, "player")), level = number(read(UnitLevel, "player")) }
    -- Session boundaries never infer gains from the offline interval.
    baseline, lastLocation = nil, nil
    isDead = read(UnitIsDeadOrGhost, "player") == true
    sample()
    snapshot()
    event("session-start")
end
local function showExport()
    snapshot()
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
    exportFrame.edit:SetText(ns.Encode(payload))
    exportFrame.edit:SetFocus()
    exportFrame.edit:HighlightText()
    if profile.dropped then print("ChaOS PvP: local retention limit reached; older observations omitted: " .. profile.dropped) end
end
frame:SetScript("OnEvent", function(_, name)
    if name == "PLAYER_LOGIN" then initialize(); return end
    if not profile or not db then return end
    if name == "PLAYER_DEAD" and not isDead then
        isDead = true
        local location = position()
        if (not location or not location.x) and lastLocation
            and (not location or location.mapId == lastLocation.mapId) then location = lastLocation end
        if location and now() - location.at > 10 then location = nil end
        event("death", 0, context(), location)
    elseif name == "PLAYER_ALIVE" or name == "PLAYER_UNGHOST" then
        isDead = read(UnitIsDeadOrGhost, "player") == true
    elseif name == "PLAYER_LOGOUT" then
        sample(); snapshot(); event("session-end")
    end
end)
for _, name in ipairs({ "PLAYER_LOGIN", "PLAYER_DEAD", "PLAYER_ALIVE", "PLAYER_UNGHOST", "PLAYER_LOGOUT" }) do
    frame:RegisterEvent(name)
end
frame:SetScript("OnUpdate", function(_, delta)
    elapsed = elapsed + delta
    if elapsed < 2 or not db or not profile then return end
    elapsed = 0
    sample()
end)
SLASH_CHAOSWORLDPVP1 = "/cvp"
SlashCmdList.CHAOSWORLDPVP = function(message)
    if not profile or not db then print("ChaOS PvP: collector unavailable."); return end
    if message == "export" then sample(); showExport()
    elseif message == "status" then
        print("ChaOS PvP " .. ns.version .. ": " .. #profile.events .. " events, " .. #profile.snapshots .. " snapshots.")
        print("HK readable: " .. tostring(number(read(GetPVPLifetimeStats)) ~= nil) .. "; map readable: " .. tostring(position() ~= nil))
        print("Ruleset: " .. profile.ruleset .. "; dropped: " .. tostring(profile.dropped or 0))
    else print("ChaOS PvP: /cvp export | /cvp status. Experimental; deaths have unknown cause.") end
end
