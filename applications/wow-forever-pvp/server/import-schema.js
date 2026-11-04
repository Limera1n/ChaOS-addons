export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_TIME = 4102444800;
const fail = () => {
  throw new Error("Export invalide ou version non prise en charge.");
};
const record = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  return value;
};
function string(value, max = 160) {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > max ||
    /[\u0000-\u001f]/u.test(value)
  )
    fail();
  return value;
}
function integer(value, max = MAX_TIME) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) fail();
  return value;
}
function optionalString(value, max) {
  return value == null ? null : string(value, max);
}
function list(value, max) {
  if (!Array.isArray(value) || value.length > max) fail();
  return value;
}
function oneOf(value, options) {
  if (!options.includes(value)) fail();
  return value;
}
function location(value) {
  if (value == null) return null;
  record(value);
  const result = {
    mapId: integer(value.mapId, 1000000),
    zone: optionalString(value.zone),
    at: integer(value.at),
  };
  if (value.x != null || value.y != null) {
    for (const key of ["x", "y"]) {
      if (
        typeof value[key] !== "number" ||
        !Number.isFinite(value[key]) ||
        value[key] < 0 ||
        value[key] > 1
      )
        fail();
      result[key] = value[key];
    }
  }
  return result;
}

// Rebuild every object rather than persisting arbitrary keys from an untrusted export.
export function validateImport(input) {
  record(input);
  if (input.format !== "chaos-world-pvp" || input.version !== 1) fail();
  const character = record(input.character);
  const result = {
    format: input.format,
    version: 1,
    sourceId: string(input.sourceId),
    addonVersion: string(input.addonVersion, 32),
    build: string(input.build, 80),
    exportedAt: integer(input.exportedAt),
    character: {
      name: string(character.name),
      realm: string(character.realm),
      region: string(character.region, 32),
      ruleset: string(character.ruleset, 32),
      class: optionalString(character.class),
      race: optionalString(character.race),
      faction: optionalString(character.faction),
      level: character.level == null ? null : integer(character.level, 1000),
    },
    snapshots: [],
    events: [],
  };
  const seen = new Set();
  function identity(item) {
    record(item);
    const id = string(item.id);
    if (seen.has(id)) fail();
    seen.add(id);
    return { id, at: integer(item.at) };
  }
  result.snapshots = list(input.snapshots, 300).map((item) => ({
    ...identity(item),
    lifetimeHK:
      item.lifetimeHK == null ? null : integer(item.lifetimeHK, 1000000000),
    guild: optionalString(item.guild),
    equipment: list(item.equipment, 19).map((slot) => {
      record(slot);
      const slotId = integer(slot.slot, 19);
      if (slotId < 1) fail();
      return {
        slot: slotId,
        itemId: integer(slot.itemId, 1000000000),
        link: optionalString(slot.link, 2048),
      };
    }),
  }));
  result.events = list(input.events, 5000).map((item) => {
    const base = identity(item);
    const eventLocation = location(item.location);
    if (
      eventLocation &&
      (eventLocation.at > base.at || base.at - eventLocation.at > 10)
    )
      fail();
    const type = oneOf(item.type, [
      "honor-gain",
      "death",
      "session-start",
      "session-end",
      "counter-reset",
    ]);
    const amount = integer(item.amount, 1000000);
    if (type === "honor-gain" ? amount < 1 : amount !== 0) fail();
    return {
      ...base,
      type,
      amount,
      context: oneOf(item.context, [
        "world",
        "pvp",
        "arena",
        "instance",
        "unknown",
      ]),
      cause: "unknown",
      location: eventLocation,
    };
  });
  if (
    [...result.events, ...result.snapshots].some(
      (item) => item.at > result.exportedAt,
    )
  )
    fail();
  return result;
}

export function characterKey(character) {
  return JSON.stringify([
    character.region,
    character.ruleset,
    character.realm,
    character.name,
  ]);
}
