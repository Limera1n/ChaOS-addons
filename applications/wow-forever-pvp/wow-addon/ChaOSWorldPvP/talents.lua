local ns = ChaOSWorldPvP
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
local function label(value)
    value = read(function() return value end)
    if type(value) == "string" and #value > 0 and #value <= 160 and not value:find("[%z\1-\31]") then return value end
end
local function coordinate(value)
    value = read(function() return value end)
    if type(value) == "number" and value == value and math.abs(value) <= 1000000 then return value end
end
local function collect(at)
    local api = C_Traits
    local configId = integer(read(C_ClassTalents and C_ClassTalents.GetActiveConfigID), 1000000000)
    if not api or not configId or configId == 0 or read(api.ConfigHasStagedChanges, configId) ~= false then return nil end
    local config = read(api.GetConfigInfo, configId)
    if not config or type(config.treeIDs) ~= "table" or #config.treeIDs == 0 or #config.treeIDs > 8 then return nil end
    local result = { at = at, configId = configId, name = label(config.name), trees = ns.Array() }
    for _, treeId in ipairs(config.treeIDs) do
        treeId = integer(treeId, 1000000000)
        if not treeId or treeId == 0 then return nil end
        local ids = read(api.GetTreeNodes, treeId)
        if type(ids) ~= "table" or #ids == 0 or #ids > 1000 then return nil end
        local info = read(api.GetTreeInfo, configId, treeId)
        local tree = { id = treeId, name = info and label(info.titleText), nodes = ns.Array() }
        for _, nodeId in ipairs(ids) do
            nodeId = integer(nodeId, 1000000000)
            if not nodeId or nodeId == 0 then return nil end
            local node = read(api.GetNodeInfo, configId, nodeId)
            if not node then return nil end
            local rank = integer(node.activeRank, 100)
            if not rank then return nil end
            if node.isVisible == true or rank > 0 then
                local item = { id = nodeId, x = coordinate(node.posX), y = coordinate(node.posY),
                    rank = rank, maxRank = integer(node.maxRanks, 100), spent = integer(node.ranksPurchased, 100),
                    entries = ns.Array(), edges = ns.Array() }
                if not item.x or not item.y or not item.maxRank or not item.spent
                    or rank > item.maxRank or item.spent > rank then return nil end
                if type(node.entryIDs) ~= "table" or #node.entryIDs == 0 or #node.entryIDs > 16 then return nil end
                if node.activeEntry then item.activeEntryId = integer(node.activeEntry.entryID, 1000000000) end
                for _, entryId in ipairs(node.entryIDs) do
                    entryId = integer(entryId, 1000000000)
                    if not entryId or entryId == 0 then return nil end
                    local entry = read(api.GetEntryInfo, configId, entryId)
                    if not entry then return nil end
                    local definition = entry.definitionID and read(api.GetDefinitionInfo, entry.definitionID)
                    if entry.definitionID and not definition then return nil end
                    local spellId = definition and integer(definition.spellID, 1000000000)
                    local spell = spellId and read(C_Spell and C_Spell.GetSpellInfo, spellId)
                    local subtree = entry.subTreeID and read(api.GetSubTreeInfo, configId, entry.subTreeID)
                    item.entries[#item.entries + 1] = { id = entryId, spellId = spellId,
                        name = (definition and label(definition.overrideName)) or (spell and label(spell.name))
                            or (subtree and label(subtree.name)) or ("Talent #" .. entryId),
                        icon = (definition and integer(definition.overrideIcon, 1000000000)) or (spell and integer(spell.iconID, 1000000000)) }
                end
                local hasActive = item.activeEntryId == nil and rank == 0
                for _, entry in ipairs(item.entries) do
                    if entry.id == item.activeEntryId then hasActive = true end
                end
                if not hasActive then return nil end
                if type(node.visibleEdges) ~= "table" or #node.visibleEdges > 32 then return nil end
                for _, edge in ipairs(node.visibleEdges) do
                    local target = integer(edge.targetNode, 1000000000)
                    if not target or target == 0 then return nil end
                    item.edges[#item.edges + 1] = target
                end
                tree.nodes[#tree.nodes + 1] = item
            end
        end
        if #tree.nodes == 0 then return nil end
        -- Edges to hidden nodes do not belong to the exported view.
        local visible = {}
        for _, node in ipairs(tree.nodes) do visible[node.id] = true end
        for _, node in ipairs(tree.nodes) do
            local edges = ns.Array()
            for _, id in ipairs(node.edges) do if visible[id] then edges[#edges + 1] = id end end
            node.edges = edges
        end
        result.trees[#result.trees + 1] = tree
    end
    -- A config switch while loading must not mix two builds.
    if read(C_ClassTalents.GetActiveConfigID) ~= configId or read(api.ConfigHasStagedChanges, configId) ~= false then return nil end
    return result
end

function ns.CaptureTalents(profile, at)
    -- Wrap nested structures too: protected fields must never escape into JSON.
    local result = read(collect, at)
    if result then profile.talents = result end
    local saved = profile.talents
    if saved then
        ns.Array(saved.trees)
        for _, tree in ipairs(saved.trees) do
            ns.Array(tree.nodes)
            for _, node in ipairs(tree.nodes) do ns.Array(node.entries); ns.Array(node.edges) end
        end
    end
    return saved
end
