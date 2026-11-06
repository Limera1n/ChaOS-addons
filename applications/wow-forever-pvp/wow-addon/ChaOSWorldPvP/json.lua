ChaOSWorldPvP = { version = "0.5.2" }
local ns = ChaOSWorldPvP
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
