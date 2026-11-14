local ns = ChaOSWorldPvP
-- Base skill lines, including gathering and secondary professions. Read by ID:
-- collapsed headers in the skills UI must not hide a learned profession.
local skillLines = { 171, 164, 333, 202, 182, 773, 755, 165, 186, 393, 197, 185, 129, 356, 794 }
local function read(fn, ...)
    if type(fn) ~= "function" then return nil end
    local ok, value = pcall(fn, ...)
    if not ok or (issecretvalue and issecretvalue(value)) then return nil end
    return value
end
local function integer(value, max)
    value = read(function() return value end)
    if type(value) == "number" and value >= 0 and value <= max and value % 1 == 0 then return value end
end
local function name(value)
    value = read(function() return value end)
    if type(value) == "string" and #value > 0 and #value <= 160 and not value:find("[%z\1-\31]") then return value end
end
local function cleanText(value, max)
    if type(value) ~= "string" then return nil end
    value = value:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "")
        :gsub("|n", " ")
        :gsub("|T.-|t", ""):gsub("|A.-|a", ""):gsub("[%z\1-\31]", " ")
        :match("^%s*(.-)%s*$")
    if #value > 0 and #value <= max then return value end
end
local function recipeReagents(id)
    return read(function()
        local schematic = read(C_TradeSkillUI.GetRecipeSchematic, id, false)
        local slots = schematic and read(function() return schematic.reagentSlotSchematics end)
        if type(slots) ~= "table" or #slots > 32 then return nil end
        local result = ns.Array()
        for _, slot in ipairs(slots) do
            local required = read(function() return slot.required end)
            local reagents = read(function() return slot.reagents end)
            if type(required) ~= "boolean" or type(reagents) ~= "table" or #reagents > 32 then return nil end
            if #reagents > 0 then
                local options = ns.Array()
                for _, reagent in ipairs(reagents) do
                    local itemId = integer(read(function() return reagent.itemID end), 1000000000)
                    local currencyId = integer(read(function() return reagent.currencyID end), 1000000000)
                    if itemId == 0 then itemId = nil end
                    if currencyId == 0 then currencyId = nil end
                    if (not itemId and not currencyId) or (itemId and currencyId) then return nil end
                    local quantity = integer(read(function() return slot.quantityRequired end), 1000000)
                    local variants = read(function() return slot.variableQuantities end)
                    if variants ~= nil and (type(variants) ~= "table" or #variants > 32) then return nil end
                    for _, variant in ipairs(variants or {}) do
                        local matches = read(function()
                            return (itemId and variant.reagent.itemID == itemId)
                                or (currencyId and variant.reagent.currencyID == currencyId)
                        end)
                        if matches then quantity = integer(read(function() return variant.quantity end), 1000000) end
                    end
                    if not quantity or quantity == 0 then return nil end
                    local label, icon
                    if itemId then
                        label = name(read(C_Item and C_Item.GetItemNameByID, itemId)) or ("Objet #" .. itemId)
                        icon = integer(read(function()
                            if not C_Item or type(C_Item.GetItemInfoInstant) ~= "function" then return nil end
                            local _, _, _, _, texture = C_Item.GetItemInfoInstant(itemId)
                            return texture
                        end), 1000000000)
                    else
                        local currency = read(C_CurrencyInfo and C_CurrencyInfo.GetCurrencyInfo, currencyId)
                        label = currency and name(read(function() return currency.name end)) or ("Monnaie #" .. currencyId)
                        icon = currency and integer(read(function() return currency.iconFileID end), 1000000000)
                    end
                    options[#options + 1] = { itemId = itemId, currencyId = currencyId, name = label, quantity = quantity, icon = icon }
                end
                result[#result + 1] = { optional = not required or nil, options = options }
            elseif required then
                return nil -- A required slot still loading must not look like a free recipe.
            end
        end
        return result
    end)
end
local function recipeVisual(id, recipe)
    return read(function()
        local link = read(C_TradeSkillUI.GetRecipeItemLink, id)
        local itemId, icon
        if type(link) == "string" and C_Item and type(C_Item.GetItemInfoInstant) == "function" then
            local item, _, _, _, texture = C_Item.GetItemInfoInstant(link)
            itemId, icon = integer(item, 1000000000), integer(texture, 1000000000)
        end
        local spell = read(C_Spell and C_Spell.GetSpellInfo, id)
        icon = icon or integer(read(function() return recipe.icon end), 1000000000)
            or (spell and integer(read(function() return spell.iconID end), 1000000000))
        local info = read(C_TooltipInfo and C_TooltipInfo.GetHyperlink, type(link) == "string" and link or ("spell:" .. id))
        local lines = ns.Array()
        if info and type(info.lines) == "table" then
            for index = 2, #info.lines do
                local line = info.lines[index]
                local left = cleanText(read(function() return line.leftText end), 300)
                local right = cleanText(read(function() return line.rightText end), 300)
                if left then lines[#lines + 1] = { text = left, right = right } end
                if #lines >= 20 then break end
            end
        end
        return { itemId = itemId, icon = icon,
            description = cleanText(read(C_Spell and C_Spell.GetSpellDescription, id), 3000),
            tooltip = #lines > 0 and lines or nil }
    end) or {}
end

local function recipeCategories(recipe, cache)
    local id = integer(read(function() return recipe.categoryID end), 1000000000)
    if not id or id == 0 then return nil end
    local path, seen = ns.Array(), {}
    while id and id > 0 do
        if seen[id] or #path >= 8 then return nil end
        seen[id] = true
        local category = cache[id]
        if not category then
            local info = read(C_TradeSkillUI.GetCategoryInfo, id)
            if not info then return nil end
            local label = name(read(function() return info.name end))
            if not label then return nil end
            category = { id = id, name = label,
                order = integer(read(function() return info.uiOrder end), 1000000) or 0,
                parent = integer(read(function() return info.parentCategoryID end), 1000000000) }
            cache[id] = category
        end
        table.insert(path, 1, { id = category.id, name = category.name, order = category.order })
        id = category.parent
    end
    return path
end

function ns.CaptureRecipes(profile, at)
    local api = C_TradeSkillUI
    if not api or read(api.IsTradeSkillLinked) ~= false or read(api.IsTradeSkillGuild) ~= false
        or read(api.IsTradeSkillReady) ~= true then return end
    local info = read(api.GetBaseProfessionInfo)
    local skillId = info and integer(read(function() return info.professionID end), 1000000)
    local supported = false
    for _, id in ipairs(skillLines) do if id == skillId then supported = true end end
    if not supported then return end
    local ids = read(api.GetAllRecipeIDs)
    if type(ids) ~= "table" or #ids > 5000 then return end
    local recipes, seen, categories = ns.Array(), {}, {}
    for _, value in ipairs(ids) do
        local id = integer(value, 1000000000)
        if not id or id == 0 or seen[id] then return end
        seen[id] = true
        local recipe = read(api.GetRecipeInfo, id)
        local learned = recipe and read(function() return recipe.learned end)
        if learned == nil then return end -- incomplete data must not erase a previous scan
        if learned == true then
            local label = name(read(function() return recipe.name end))
            if not label then return end
            local visual = recipeVisual(id, recipe)
            recipes[#recipes + 1] = { id = id, name = label, icon = visual.icon, itemId = visual.itemId,
                categoryPath = recipeCategories(recipe, categories),
                reagents = recipeReagents(id),
                description = visual.description, tooltip = visual.tooltip,
                available = integer(read(api.GetCraftableCount, id), 1000000) }
        end
    end
    table.sort(recipes, function(a, b) return a.id < b.id end)
    profile.professionRecipes = profile.professionRecipes or {}
    profile.professionRecipes[tostring(skillId)] = { at = at, recipes = recipes }
end

function ns.CollectProfessions(profile, at)
    local api = C_SkillInfo
    if not api or not integer(read(api.GetNumSkillLines), 10000) then return nil end
    if read(api.GetNumSkillLines) == 0 or type(api.GetSkillLineInfoByID) ~= "function" then return nil end
    local items = ns.Array()
    for _, id in ipairs(skillLines) do
        local ok, info = pcall(api.GetSkillLineInfoByID, id)
        if not ok or (issecretvalue and issecretvalue(info)) then return nil end
        if info then
            local label = name(read(function() return info.name end))
            local rank = integer(read(function() return info.rank end), 10000)
            local maxRank = integer(read(function() return info.maxRank end), 10000)
            if not label or not rank or not maxRank or rank > maxRank then return nil end
            if maxRank > 0 then
                local item = { skillLineId = id, name = label, rank = rank, maxRank = maxRank }
                local cached = profile.professionRecipes and profile.professionRecipes[tostring(id)]
                if cached then
                    item.recipesAt, item.recipes = cached.at, ns.Array(cached.recipes)
                    for _, recipe in ipairs(item.recipes) do
                        if recipe.tooltip then ns.Array(recipe.tooltip) end
                        if recipe.categoryPath then ns.Array(recipe.categoryPath) end
                        if recipe.reagents then
                            ns.Array(recipe.reagents)
                            for _, slot in ipairs(recipe.reagents) do ns.Array(slot.options) end
                        end
                    end
                end
                items[#items + 1] = item
            end
        end
    end
    -- Drop abandoned skills so relearning does not resurrect an old recipe book.
    local cache = {}
    for _, item in ipairs(items) do
        cache[tostring(item.skillLineId)] = profile.professionRecipes and profile.professionRecipes[tostring(item.skillLineId)]
    end
    profile.professionRecipes = cache
    return { at = at, items = items }
end
