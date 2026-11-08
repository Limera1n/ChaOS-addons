ChaOSWorldPvP = { version = "0.5.9" }
local ns = ChaOSWorldPvP
-- Send each distinct loadout once, while retaining every dated observation.
-- Copy snapshot metadata so exporting never rewrites SavedVariables history.
function ns.CompactSnapshots(snapshots)
    local result, sets = ns.Array(), ns.Array()
    local known = {}
    for _, snapshot in ipairs(snapshots) do
        local encoded = ns.Encode(ns.Array(snapshot.equipment))
        local reference = known[encoded]
        if reference == nil then
            reference = #sets
            known[encoded] = reference
            sets[#sets + 1] = snapshot.equipment
        end
        local copy = {}
        for key, value in pairs(snapshot) do if key ~= "equipment" then copy[key] = value end end
        copy.equipmentRef = reference
        result[#result + 1] = copy
    end
    return result, sets
end
local arrayMeta = {}
function ns.Array(value) return setmetatable(value or {}, arrayMeta) end
local function quote(value)
    return '"' .. value:gsub('[%z\1-\31\\"]', function(char)
        return string.format("\\u%04x", string.byte(char))
    end) .. '"'
end
function ns.Encode(value)
    local kind = type(value)
    if kind == "nil" then return "null" end
    if kind == "boolean" then return value and "true" or "false" end
    if kind == "string" then return quote(value) end
    if kind == "number" then
        assert(value == value and value ~= math.huge and value ~= -math.huge, "Invalid JSON number")
        return tostring(value)
    end
    assert(kind == "table", "Unsupported JSON value")
    local parts = {}
    if getmetatable(value) == arrayMeta then
        for index = 1, #value do parts[index] = ns.Encode(value[index]) end
        return "[" .. table.concat(parts, ",") .. "]"
    end
    for key, item in pairs(value) do
        assert(type(key) == "string", "Invalid JSON key")
        parts[#parts + 1] = quote(key) .. ":" .. ns.Encode(item)
    end
    table.sort(parts)
    return "{" .. table.concat(parts, ",") .. "}"
end
