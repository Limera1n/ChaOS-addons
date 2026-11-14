dofile("wow-addon/ChaOSWorldPvP/json.lua")
dofile("wow-addon/ChaOSWorldPvP/talents.lua")
local ns, profile = ChaOSWorldPvP, {}
local staged, missing, configId = false, false, 12
local secret = {}
function issecretvalue(value) return value == secret end
C_ClassTalents = { GetActiveConfigID = function() return configId end }
C_Traits = {
    ConfigHasStagedChanges = function() return staged end,
    GetConfigInfo = function() return { name = "Build test", treeIDs = { 1 } } end,
    GetTreeInfo = function() return { titleText = "Arbre de classe" } end,
    GetTreeNodes = function() return { 10, 20, 30 } end,
    GetNodeInfo = function(_, id)
        if missing then return nil end
        return { posX = id * 10, posY = id * 20, isVisible = id ~= 30,
            activeRank = id == 10 and 2 or 0, maxRanks = 5, ranksPurchased = id == 10 and 1 or 0,
            activeEntry = id == 10 and { entryID = 101, rank = 2 } or nil,
            entryIDs = id == 10 and { 100, 101 } or { 200 },
            visibleEdges = id == 10 and { { targetNode = 20 }, { targetNode = 30 } } or {} }
    end,
    GetEntryInfo = function(_, id) return { definitionID = id } end,
    GetDefinitionInfo = function(id) return { spellID = id + 1000 } end,
}
C_Spell = { GetSpellInfo = function(id) return { name = "Sort " .. id, iconID = 123 } end }
local result = ns.CaptureTalents(profile, 100)
assert(result.at == 100 and result.configId == 12)
assert(#result.trees[1].nodes == 2)
local node = result.trees[1].nodes[1]
assert(node.rank == 2 and node.spent == 1 and node.activeEntryId == 101)
assert(#node.entries == 2 and node.entries[2].name == "Sort 1101")
assert(#node.edges == 1 and node.edges[1] == 20, "Hidden node edges are removed")
staged = true
assert(ns.CaptureTalents(profile, 110).at == 100, "Draft builds cannot replace committed talents")
staged = false; missing = true
assert(ns.CaptureTalents(profile, 120).at == 100, "Incomplete scans preserve the last dated build")
missing = false; configId = secret
assert(ns.CaptureTalents(profile, 130).at == 100, "Secret config values are unavailable")
configId = 12
local oldGetNode = C_Traits.GetNodeInfo
C_Traits.GetNodeInfo = function(...) local n = oldGetNode(...); n.ranksPurchased = secret; return n end
assert(ns.CaptureTalents(profile, 140).at == 100, "Nested secret values discard the scan")
C_Traits.GetNodeInfo = oldGetNode
-- SavedVariables removes array metatables on reload; empty edge lists must be [].
setmetatable(profile.talents.trees[1].nodes[2].edges, nil)
C_Traits = nil
assert(ns.Encode(ns.CaptureTalents(profile, 150)):find('"edges":%[%]'))
assert(ns.CaptureTalents({}, 160) == nil, "Missing APIs do not fabricate an empty tree")
print("Talent simulated scenario passed")
