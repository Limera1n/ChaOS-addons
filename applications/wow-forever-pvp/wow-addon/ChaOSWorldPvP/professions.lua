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
    local recipes, seen = ns.Array(), {}
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
            recipes[#recipes + 1] = { id = id, name = label,
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
