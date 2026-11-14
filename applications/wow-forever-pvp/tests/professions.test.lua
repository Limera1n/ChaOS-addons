dofile("wow-addon/ChaOSWorldPvP/json.lua")
dofile("wow-addon/ChaOSWorldPvP/professions.lua")
local ns, profile = ChaOSWorldPvP, {}
local linked, ready, learned, failInfo = false, true, true, false
local secret = {}
function issecretvalue(value) return value == secret end
C_SkillInfo = {
    GetNumSkillLines = function() return 2 end,
    GetSkillLineInfoByID = function(id)
        if id == 164 and learned then return { name = "Forge", rank = 0, maxRank = 300 } end
    end,
}
C_TradeSkillUI = {
    IsTradeSkillLinked = function() return linked end,
    IsTradeSkillGuild = function() return false end,
    IsTradeSkillReady = function() return ready end,
    GetBaseProfessionInfo = function() return { professionID = 164 } end,
    GetAllRecipeIDs = function() return { 10, 20, 30 } end,
    GetRecipeInfo = function(id)
        if failInfo then return nil end
        return { name = "Recipe " .. id, learned = id ~= 20 }
    end,
    GetCraftableCount = function(id) if id == 10 then return 0 end return secret end,
}
ns.CaptureRecipes(profile, 100)
local result = ns.CollectProfessions(profile, 110)
assert(result.items[1].rank == 0)
assert(#result.items[1].recipes == 2)
assert(result.items[1].recipes[1].available == 0)
assert(result.items[1].recipes[2].available == nil)
assert(result.items[1].recipesAt == 100)
for _, mode in ipairs({ "linked", "loading", "incomplete" }) do
    linked, ready, failInfo = mode == "linked", mode ~= "loading", mode == "incomplete"
    ns.CaptureRecipes(profile, 120)
    assert(profile.professionRecipes["164"].at == 100)
end
-- Reload loses metatables; export must still encode empty arrays correctly.
profile.professionRecipes["164"].recipes = {}
assert(ns.Encode(ns.CollectProfessions(profile, 130)):find('"recipes":%[%]'))
learned = false
assert(#ns.CollectProfessions(profile, 140).items == 0)
assert(profile.professionRecipes["164"] == nil)
learned = true
assert(ns.CollectProfessions(profile, 150).items[1].recipes == nil)
C_SkillInfo.GetSkillLineInfoByID = function() error("unavailable") end
assert(ns.CollectProfessions(profile, 160) == nil)
print("Profession simulated scenario passed")
