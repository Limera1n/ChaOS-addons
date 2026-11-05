-- Only a client test can establish that these APIs behave this way on Forever.
local clock, hk, instance, hasPosition = 1000, 100, "none", true
local isPlayerDead = false
local playerSex = 2
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
local function fire(name) collector.scripts.OnEvent(collector, name) end
local function tick(seconds)
    clock = clock + seconds
    collector.scripts.OnUpdate(collector, seconds)
end
local function currentProfile()
    for _, profile in pairs(ChaOSWorldPvPDB.profiles) do return profile end
end
fire("PLAYER_LOGIN")
local profile = currentProfile()
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

playerSex = 3
SlashCmdList.CHAOSWORLDPVP("export")
local payload
for _, value in ipairs(frames) do
    if type(value.edit) == "table" then payload = value.edit.text end
end
assert(type(payload) == "string" and payload:find('"format":"chaos%-world%-pvp"'))
assert(payload:find('"equipment":%['))
assert(payload:find('"raceId":1') and payload:find('"sex":3'))
assert(payload:find('"icon":133138') and payload:find('"quality":4'))
assert(payload:find('"cause":"pve"') and payload:find('"source":"Fatal pet"'))
assert(payload:find('\\u0022Hat\\u0022'))
assert(not payload:find('"lifetimeHK":{}'))
-- Available to the optional Wasmoon runner for validation with the real import schema.
collectorTestPayload = payload
print("Collector simulated scenario passed")
