-- Only a client test can establish that these APIs behave this way on Forever.
local clock, hk, instance, hasPosition = 1000, 100, "none", true
local isPlayerDead = false
local playerSex = 2
local barberSex, barberChoice, barberDirty = 0, 2, false
local frames = {}
local function widget()
    local value = { scripts = {} }
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

-- Forever/Classic may expose combat logs without either recap API.
C_DeathRecap = nil
function UnitGUID() return "Player-0-me" end
local combatArgs
function CombatLogGetCurrentEventInfo() return table.unpack(combatArgs) end
local function revive()
    isPlayerDead = false; fire("PLAYER_ALIVE"); tick(3)
end
local function die()
    isPlayerDead = true; fire("PLAYER_DEAD")
    return profile.events[#profile.events]
end
local function swing(source, flags, overkill, destination)
    combatArgs = { clock, "SWING_DAMAGE", false, source, "Attacker", flags, 0,
        destination or "Player-0-me", "Me", 0, 0, 50, overkill }
    fire("COMBAT_LOG_EVENT_UNFILTERED")
end
revive()
swing("Player-0-enemy", 0x1100, 0)
assert(die().cause == "pvp", "Combat log must work without death recap")
revive()
death = die()
swing("Creature-0-enemy", 0x2200, 1)
assert(death.cause == "pve", "A fatal event may arrive after PLAYER_DEAD")
revive()
swing("Player-0-enemy", 0x1100, -1)
death = die()
assert(death.cause == "unknown", "A nonfatal hit must not be blamed for death")
revive()
swing("Player-0-enemy", 0x1100, 0, "Player-0-other")
assert(die().cause == "unknown", "Other players' deaths must not be attributed")
revive()
swing(secret, 0x1100, 0)
assert(die().cause == "unknown", "Restricted values must be ignored")
revive()
swing("Creature-0-enemy", 0x2200, 0)
tick(4)
assert(die().cause == "unknown", "Old fatal hits must expire")
revive()
combatArgs = { clock, "SPELL_PERIODIC_DAMAGE", false, "Pet-0-enemy", "Pet", 0x1100, 0,
    "Player-0-me", "Me", 0, 0, 123, "Poison", 8, 50, 0 }
fire("COMBAT_LOG_EVENT_UNFILTERED")
assert(die().cause == "pvp")
revive()
combatArgs = { clock, "ENVIRONMENTAL_DAMAGE", false, "", "", 0, 0,
    "Player-0-me", "Me", 0, 0, "FALLING", 50, 0 }
fire("COMBAT_LOG_EVENT_UNFILTERED")
assert(die().cause == "environment")
revive()
swing("Player-0-me", 0x1101, 0)
assert(die().cause == "self")
revive()
-- The legacy global recap function is supported too.
DeathRecap_GetEvents = function()
    return { { timestamp = clock + 0.5, overkill = 0, sourceGUID = "Creature-0-enemy" } }
end
assert(die().cause == "pve")
DeathRecap_GetEvents = nil

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
