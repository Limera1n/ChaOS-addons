-- Only a client test can establish that these APIs behave this way on Forever.
local clock, hk, instance, hasPosition = 1000, 100, "none", true
local isPlayerDead = false
local playerSex = 2
local barberSex, barberChoice, barberDirty = 0, 2, false
local frames = {}
local combatLogRegistrations = 0
local function widget()
    local value = { scripts = {} }
    function value:RegisterEvent(name)
        if name == "COMBAT_LOG_EVENT_UNFILTERED" then
            combatLogRegistrations = combatLogRegistrations + 1
            error("Protected event registration")
        end
    end
    setmetatable(value, { __index = function(_, name)
        if name == "SetScript" then return function(self, event, callback) self.scripts[event] = callback end end
        if name == "SetText" then return function(self, text) self.text = text end end
        return function() end
    end })
    return value
end
function CreateFrame()
    local value = widget()
    value.TitleText = widget()
    frames[#frames + 1] = value
    return value
end
function GetServerTime() return clock end
function GetUnitName() return "Test Player" end
function GetRealmName() return "Test Realm" end
function GetCurrentRegion() return 3 end
function UnitClass() return "Warrior" end
function UnitRace() return "Human", "Human", 1 end
function UnitSex() return playerSex end
C_BarberShop = {
    HasAnyChanges = function() return barberDirty end,
    GetCurrentCharacterData = function() return { sex = barberSex } end,
    GetAvailableCustomizations = function()
        return { { options = {
            { id = 31, currentChoiceIndex = barberChoice, choices = { { id = 120 }, { id = 130 } } },
            { id = 33, currentChoiceIndex = 1, choices = { { id = 211 } } },
            { id = 37, choices = { { id = 499 } } },
        } } }
    end,
}
function UnitFactionGroup() return "Alliance" end
function UnitLevel() return 60 end
function UnitIsDeadOrGhost() return isPlayerDead end
function GetPVPLifetimeStats() return hk end
function GetGuildInfo() return "Test Guild" end
function GetRealZoneText() return "Test Zone" end
function GetInventoryItemID(_, slot) if slot == 1 then return 123 end end
function GetInventoryItemLink() return '|Hitem:123|h[Test "Hat"]|h' end
function GetInventoryItemTexture() return 133138 end
C_Item = { GetItemQualityByID = function() return 4 end }
function GetBuildInfo() return "1.60.1", "test-build" end
function IsInInstance() return instance ~= "none", instance end
local secret = {}
function issecretvalue(value) return value == secret end
local honor = 100
C_CurrencyInfo = { GetCurrencyInfo = function(id)
    assert(id == 1792)
    return { quantity = honor }
end }
C_Map = {
    GetBestMapForUnit = function() return 37 end,
    GetPlayerMapPosition = function()
        if hasPosition then return { GetXY = function() return 0.2, 0.3 end } end
    end,
}
SlashCmdList = {}

dofile("wow-addon/ChaOSWorldPvP/json.lua")
dofile("wow-addon/ChaOSWorldPvP/collector.lua")
local collector = frames[1]
local function fire(name, ...) collector.scripts.OnEvent(collector, name, ...) end
local function tick(seconds)
    clock = clock + seconds
    collector.scripts.OnUpdate(collector, seconds)
end
local function currentProfile()
    for _, profile in pairs(ChaOSWorldPvPDB.profiles) do return profile end
end
fire("PLAYER_LOGIN")
local profile = currentProfile()
fire("BARBER_SHOP_OPEN")
assert(profile.appearance.sex == 2 and #profile.appearance.choices == 2)
assert(profile.appearance.choices[1].choiceId == 130)
barberDirty, barberChoice = true, 1
SlashCmdList.CHAOSWORLDPVP("appearance")
fire("BARBER_SHOP_RESULT", false)
fire("BARBER_SHOP_CLOSE")
assert(profile.appearance.choices[1].choiceId == 130, "Cancelled previews must not replace the capture")
barberDirty, barberChoice = false, 2
assert(#profile.events == 1 and profile.events[1].type == "session-start")
assert(#profile.snapshots == 1 and profile.snapshots[1].lifetimeHK == 100)
hk = 102; tick(2)
assert(profile.events[2].amount == 2 and profile.events[2].context == "world")
assert(profile.events[2].location.x == 0.2)
instance = "pvp"; tick(2); hk = 103; tick(2)
assert(profile.events[3].context == "pvp")
instance = "none"; hk = 104; tick(2)
assert(profile.events[4].context == "unknown")
hk = 105; tick(10)
assert(profile.events[5].context == "unknown" and not profile.events[5].location)
hasPosition = false; tick(2); isPlayerDead = true; fire("PLAYER_DEAD"); fire("PLAYER_DEAD")
assert(profile.events[6].type == "death" and profile.events[6].cause == "unknown")
assert(profile.events[6].location.at < profile.events[6].at)
assert(#profile.events == 6)
isPlayerDead = false; fire("PLAYER_ALIVE")
hk = secret; tick(2)
hk = 200; tick(2)
assert(#profile.events == 6, "Unreadable interval must not fabricate gains")
fire("PLAYER_LOGOUT")
local count = #profile.events
hk = 300; fire("PLAYER_LOGIN")
assert(#profile.events == count + 1, "Offline gains must not produce an event")

local recap, retry
C_DeathRecap = { GetRecapEvents = function() return recap end }
C_Timer = { After = function(_, callback) retry = callback end }
isPlayerDead = true; fire("PLAYER_DEAD")
local death = profile.events[#profile.events]
assert(death.cause == "unknown" and retry)
recap = {
    { timestamp = clock, overkill = -1, sourceGUID = "Creature-0-1", sourceName = "Other hit" },
    { timestamp = clock + 0.1, overkill = 0, sourceGUID = "Pet-0-2", sourceFlags = 0x1100, sourceName = "Fatal pet" },
}
retry()
assert(death.cause == "pvp" and death.source == "Fatal pet")

isPlayerDead = false; fire("PLAYER_ALIVE")
isPlayerDead = true; fire("PLAYER_DEAD")
death = profile.events[#profile.events]
assert(death.cause == "unknown", "A previous recap must not be reused")
recap = { { timestamp = clock + 0.2, overkill = 5, event = "ENVIRONMENTAL_DAMAGE", sourceName = secret } }
retry()
assert(death.cause == "environment" and not death.source)

isPlayerDead = false; fire("PLAYER_UNGHOST")
isPlayerDead = true; fire("PLAYER_DEAD")
death = profile.events[#profile.events]
recap = { { timestamp = clock + 0.3, overkill = 0, sourceGUID = "Creature-0-3", sourceName = "Fatal creature" } }
retry()
assert(death.cause == "pve" and death.source == "Fatal creature")

-- The presence of the API does not mean event registration is permitted.
assert(combatLogRegistrations == 0, "Do not probe the protected combat-log event, even inside pcall")
C_DeathRecap = nil
function CombatLogGetCurrentEventInfo() error("Combat log must not be queried") end
local function revive()
    isPlayerDead = false; fire("PLAYER_ALIVE"); tick(3)
end
local function die()
    isPlayerDead = true; fire("PLAYER_DEAD")
    return profile.events[#profile.events]
end
revive()
death = die()
for _ = 1, 3 do retry() end
assert(death.cause == "unknown" and not death.source, "Missing recap must leave cause unknown")
SlashCmdList.CHAOSWORLDPVP("status")
revive()
-- The legacy global recap function is supported too.
DeathRecap_GetEvents = function()
    return { { timestamp = clock + 0.5, overkill = 0, sourceGUID = "Creature-0-enemy" } }
end
assert(die().cause == "pve")
DeathRecap_GetEvents = nil

-- Honor is a separate currency: do not count points as honorable kills.
local honorStart, hkBeforeHonor = #profile.events, hk
honor = 125; fire("CURRENCY_DISPLAY_UPDATE", 1792)
assert(#profile.events == honorStart + 1)
assert(profile.events[#profile.events].type == "honor-points-gain" and profile.events[#profile.events].amount == 25)
tick(2)
assert(#profile.events == honorStart + 1, "Polling must not duplicate the currency event")
honor = 0; fire("CURRENCY_DISPLAY_UPDATE", 1792)
assert(profile.events[#profile.events].type == "honor-points-loss" and profile.events[#profile.events].amount == 125)
honor = 10; tick(2)
assert(profile.events[#profile.events].type == "honor-points-gain" and profile.events[#profile.events].amount == 10)
assert(hk == hkBeforeHonor)
local beforeUnavailable = #profile.events
honor = secret; tick(2)
honor = 500; tick(2)
assert(#profile.events == beforeUnavailable, "Do not infer honor across unreadable intervals")
honor = 510; tick(10)
assert(profile.events[#profile.events].context == "unknown", "A long interval cannot locate the honor gain")
local beforeReconnect = #profile.events
honor = 900; fire("PLAYER_LOGIN")
assert(#profile.events == beforeReconnect + 1, "Offline honor is not an observed gain")
SlashCmdList.CHAOSWORLDPVP("honor")
assert(profile.snapshots[#profile.snapshots].honorPoints == 900)
local beforeMissingAPI = #profile.events
C_CurrencyInfo = nil; tick(2)
assert(#profile.events == beforeMissingAPI)
C_CurrencyInfo = { GetCurrencyInfo = function() return { quantity = 0 } end }
tick(2)
assert(#profile.events == beforeMissingAPI, "Restoring the API must not create an honor loss")

fire("BARBER_SHOP_OPEN")
barberDirty, barberChoice, barberSex = true, 1, 1
fire("BARBER_SHOP_RESULT", true)
fire("BARBER_SHOP_CLOSE")
playerSex = 3
C_TooltipInfo = { GetInventoryItem = function()
    return { lines = {
        { leftText = "Test Hat" },
        { leftText = " |cff00ff00+2 Agilité|r ", leftColor = { r = 0, g = 1, b = 0 } },
        { leftText = "Tête", rightText = "Tissu" },
        { leftText = secret },
    } }
end }
SlashCmdList.CHAOSWORLDPVP("export")
local payload
for _, value in ipairs(frames) do
    if type(value.edit) == "table" then payload = value.edit.text end
end
assert(type(payload) == "string" and payload:find('"format":"chaos%-world%-pvp"'))
assert(payload:find('"equipment":%['))
assert(payload:find('"honorPoints":0') and payload:find('"honor%-points%-gain"'))
assert(payload:find('"raceId":1') and payload:find('"sex":3'))
assert(payload:find('"appearance":') and payload:find('"choiceId":120'))
assert(payload:find('"icon":133138') and payload:find('"quality":4'))
assert(payload:find('"text":"+2 Agilité"', 1, true) and payload:find('"right":"Tissu"', 1, true))
assert(not profile.snapshots[#profile.snapshots].equipment[1].tooltip, "Tooltips must not accumulate in the export history")
assert(payload:find('"cause":"pve"') and payload:find('"source":"Fatal pet"'))
assert(payload:find('\\u0022Hat\\u0022'))
assert(not payload:find('"lifetimeHK":{}'))
-- Available to the optional Wasmoon runner for validation with the real import schema.
collectorTestPayload = payload
print("Collector simulated scenario passed")
