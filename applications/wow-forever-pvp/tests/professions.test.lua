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
        return { name = "Recipe " .. id, learned = id ~= 20, categoryID = id == 10 and 2 or 3 }
    end,
    GetCategoryInfo = function(id)
        return ({
            [1] = { name = "Équipement", uiOrder = 1 },
            [2] = { name = "Armes", uiOrder = 2, parentCategoryID = 1 },
            [3] = { name = "Bottes", uiOrder = 1, parentCategoryID = 1 },
        })[id]
    end,
    GetCraftableCount = function(id) if id == 10 then return 0 end return secret end,
    GetRecipeItemLink = function(id) if id == 10 then return "item:123" end end,
    GetRecipeSchematic = function(id, recraft)
        assert(recraft == false)
        return { reagentSlotSchematics = {
            { required = true, quantityRequired = 2, reagents = { { itemID = 10940 } } },
            { required = true, quantityRequired = 4, reagents = { { itemID = 2589 }, { itemID = 2592 } },
                variableQuantities = { { reagent = { itemID = 2592 }, quantity = 6 } } },
            { required = false, quantityRequired = 3, reagents = { { currencyID = 55 } } },
        } }
    end,
}
C_Item = { GetItemInfoInstant = function() return 123, nil, nil, nil, 456 end,
    GetItemNameByID = function(id) return id == 10940 and "Strange Dust" or "Cloth" end }
C_CurrencyInfo = { GetCurrencyInfo = function() return { name = "Monnaie", iconFileID = 789 } end }
C_Spell = { GetSpellInfo = function() return { iconID = 789 } end,
    GetSpellDescription = function() return "|cff00ff00Effet du sort|r" end }
C_TooltipInfo = { GetHyperlink = function() return { lines = {
    { leftText = "Titre" }, { leftText = "|cff00ff00+7 Endurance|r", rightText = "Tissu" },
} } end }
ns.CaptureRecipes(profile, 100)
local result = ns.CollectProfessions(profile, 110)
assert(result.items[1].rank == 0)
assert(#result.items[1].recipes == 2)
assert(result.items[1].recipes[1].available == 0)
assert(result.items[1].recipes[2].available == nil)
assert(result.items[1].recipesAt == 100)
assert(result.items[1].recipes[1].itemId == 123)
assert(result.items[1].recipes[1].icon == 456, "Use crafted item icon before spell icon")
assert(result.items[1].recipes[2].icon == 789, "Enchants use the spell icon")
assert(result.items[1].recipes[1].description == "Effet du sort")
assert(result.items[1].recipes[1].tooltip[1].text == "+7 Endurance")
assert(#result.items[1].recipes[1].categoryPath == 2)
assert(result.items[1].recipes[1].categoryPath[1].name == "Équipement")
assert(result.items[1].recipes[1].categoryPath[2].name == "Armes")
assert(result.items[1].recipes[1].categoryPath[2].order == 2)
local costs = result.items[1].recipes[1].reagents
assert(costs[1].options[1].name == "Strange Dust" and costs[1].options[1].quantity == 2)
assert(costs[1].options[1].icon == 456)
assert(costs[2].options[1].quantity == 4 and costs[2].options[2].quantity == 6)
assert(costs[3].optional == true and costs[3].options[1].currencyId == 55)
assert(costs[3].options[1].quantity == 3)
assert(costs[3].options[1].icon == 789)
assert(result.items[1].recipes[2].reagents[1].options[1].quantity == 2, "Every recipe captures costs, including those without output items")
setmetatable(profile.professionRecipes["164"].recipes[1].reagents, nil)
setmetatable(profile.professionRecipes["164"].recipes[1].reagents[1].options, nil)
assert(ns.Encode(ns.CollectProfessions(profile, 110)):find('"options":%[%{'), "Reload restores nested reagent arrays")
local schematic = C_TradeSkillUI.GetRecipeSchematic
C_TradeSkillUI.GetRecipeSchematic = function() return { reagentSlotSchematics = {} } end
ns.CaptureRecipes(profile, 111)
assert(#profile.professionRecipes["164"].recipes[1].reagents == 0)
assert(ns.Encode(ns.CollectProfessions(profile, 111)):find('"reagents":%[%]'))
for _, quantity in ipairs({ 0, -1, secret }) do
    C_TradeSkillUI.GetRecipeSchematic = function()
        return { reagentSlotSchematics = { { required = true, quantityRequired = quantity, reagents = { { itemID = 10940 } } } } }
    end
    ns.CaptureRecipes(profile, 112)
    assert(profile.professionRecipes["164"].recipes[1].reagents == nil, "Unavailable quantities must not become zero or one")
end
C_TradeSkillUI.GetRecipeSchematic = nil
ns.CaptureRecipes(profile, 112)
assert(profile.professionRecipes["164"].recipes[1].reagents == nil)
C_TradeSkillUI.GetRecipeSchematic = schematic
ns.CaptureRecipes(profile, 100)
local getCategory = C_TradeSkillUI.GetCategoryInfo
C_TradeSkillUI.GetCategoryInfo = function(id) return { name = "Cycle", parentCategoryID = id } end
ns.CaptureRecipes(profile, 111)
assert(profile.professionRecipes["164"].recipes[1].categoryPath == nil, "Cycles must not hang the export")
C_TradeSkillUI.GetCategoryInfo = nil
ns.CaptureRecipes(profile, 112)
assert(profile.professionRecipes["164"].recipes[1].categoryPath == nil, "Missing category APIs keep recipes usable")
C_TradeSkillUI.GetCategoryInfo = getCategory
ns.CaptureRecipes(profile, 100)
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
