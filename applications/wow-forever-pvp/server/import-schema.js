import { identityRuleset, playerKey, playerName } from "../client/identity.js";
import { statKeys } from "../client/character-stats.js";

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
    // eslint-disable-next-line no-control-regex -- exported names must reject control bytes
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
function characterAppearance(value, character, exportedAt) {
  record(value);
  const at = integer(value.at);
  const raceId = integer(value.raceId, 10000);
  const sex = oneOf(value.sex, [2, 3]);
  if (!raceId || at > exportedAt || raceId !== character.raceId || sex !== character.sex) fail();
  const seen = new Set();
  const choices = list(value.choices, 64).map((pair) => {
    record(pair);
    const optionId = integer(pair.optionId, 999999999);
    const choiceId = integer(pair.choiceId, 999999999);
    if (!optionId || !choiceId || seen.has(optionId)) fail();
    seen.add(optionId);
    return { optionId, choiceId };
  });
  if (!choices.length) fail();
  return { at, raceId, sex, choices };
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

function playedTime(item) {
  if (item.playedSeconds == null && item.playedAt == null) return {};
  const playedSeconds = integer(item.playedSeconds);
  const playedAt = integer(item.playedAt);
  if (playedAt > item.at) fail();
  return { playedSeconds, playedAt };
}

function snapshotEquipment(item, sets) {
  if (item.equipmentRef == null) return item.equipment;
  if (item.equipment != null || !sets) fail();
  const index = integer(item.equipmentRef, 299);
  if (index >= sets.length) fail();
  return sets[index];
}

function talents(value, exportedAt) {
  record(value);
  const at = integer(value.at);
  const positiveId = (id) => { const result = integer(id, 1000000000); if (!result) fail(); return result; };
  const unique = (values) => { if (new Set(values).size !== values.length) fail(); };
  const coordinate = (n) => { if (typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 1000000) fail(); return n; };
  if (at > exportedAt) fail();
  const trees = list(value.trees, 8).map((tree) => {
    record(tree);
    const nodes = list(tree.nodes, 1000).map((node) => {
      record(node);
      const entries = list(node.entries, 16).map((entry) => {
        record(entry);
        return { id: positiveId(entry.id), name: string(entry.name),
          ...(entry.spellId == null ? {} : { spellId: positiveId(entry.spellId) }),
          ...(entry.icon == null ? {} : { icon: integer(entry.icon, 1000000000) }) };
      });
      if (!entries.length) fail();
      unique(entries.map((entry) => entry.id));
      const result = { id: positiveId(node.id), x: coordinate(node.x), y: coordinate(node.y),
        rank: integer(node.rank, 100), maxRank: integer(node.maxRank, 100), spent: integer(node.spent, 100),
        entries, edges: list(node.edges, 32).map(positiveId),
        ...(node.activeEntryId == null ? {} : { activeEntryId: positiveId(node.activeEntryId) }) };
      unique(result.edges);
      if (result.rank > result.maxRank || result.spent > result.rank || result.edges.includes(result.id)) fail();
      if (result.activeEntryId != null && !entries.some((entry) => entry.id === result.activeEntryId)) fail();
      if (result.rank > 0 && result.activeEntryId == null) fail();
      return result;
    });
    if (!nodes.length) fail();
    unique(nodes.map((node) => node.id));
    const ids = new Set(nodes.map((node) => node.id));
    if (nodes.some((node) => node.edges.some((id) => !ids.has(id)))) fail();
    return { id: positiveId(tree.id), ...(tree.name == null ? {} : { name: string(tree.name) }), nodes };
  });
  if (!trees.length) fail();
  unique(trees.map((tree) => tree.id));
  return { at, configId: positiveId(value.configId), ...(value.name == null ? {} : { name: string(value.name) }), trees };
}

function professions(value, exportedAt) {
  record(value);
  const at = integer(value.at);
  if (at > exportedAt) fail();
  const seen = new Set();
  const items = list(value.items, 16).map((item) => {
    record(item);
    const skillLineId = integer(item.skillLineId, 1000000);
    if (!skillLineId || seen.has(skillLineId)) fail();
    seen.add(skillLineId);
    const result = { skillLineId, name: string(item.name), rank: integer(item.rank, 10000), maxRank: integer(item.maxRank, 10000) };
    if (!result.maxRank || result.rank > result.maxRank) fail();
    if (item.recipes != null || item.recipesAt != null) {
      result.recipesAt = integer(item.recipesAt);
      if (result.recipesAt > at) fail();
      const ids = new Set();
      result.recipes = list(item.recipes, 5000).map((recipe) => {
        record(recipe);
        const id = integer(recipe.id, 1000000000);
        if (!id || ids.has(id)) fail();
        ids.add(id);
        return { id, name: string(recipe.name), ...(recipe.available == null ? {} : { available: integer(recipe.available, 1000000) }) };
      });
    }
    return result;
  });
  return { at, items };
}

function characterStats(value) {
  if (value == null) return {};
  record(value);
  const stats = {};
  for (const key of statKeys) {
    if (value[key] == null) continue;
    if (typeof value[key] !== "number" || !Number.isFinite(value[key]) || Math.abs(value[key]) > 1000000000) fail();
    stats[key] = value[key];
  }
  return { stats };
}

// Rebuild every object rather than persisting arbitrary keys from an untrusted export.
export function validateImport(input) {
  record(input);
  if (input.format !== "chaos-world-pvp" || input.version !== 1) fail();
  const character = record(input.character);
  const equipmentSets = input.equipmentSets == null ? null : list(input.equipmentSets, 300).map((items) => list(items, 19));
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
      ...(character.raceId == null ? {} : { raceId: integer(character.raceId, 10000) }),
      ...(character.sex == null ? {} : { sex: oneOf(character.sex, [2, 3]) }),
      faction: optionalString(character.faction),
      level: character.level == null ? null : integer(character.level, 1000),
    },
    snapshots: [],
    events: [],
  };
  result.character.ruleset = identityRuleset(result.character);
  if (input.professions != null) result.professions = professions(input.professions, result.exportedAt);
  if (input.talents != null) result.talents = talents(input.talents, result.exportedAt);
  result.character.name = playerName(result.character);
  if (character.appearance != null)
    result.character.appearance = characterAppearance(character.appearance, result.character, result.exportedAt);
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
    ...playedTime(item),
    ...characterStats(item.stats),
    lifetimeHK:
      item.lifetimeHK == null ? null : integer(item.lifetimeHK, 1000000000),
    ...(item.honorPoints == null ? {} : { honorPoints: integer(item.honorPoints, 100000000) }),
    guild: optionalString(item.guild),
    ...(item.guildKnown == null ? {} : { guildKnown: oneOf(item.guildKnown, [true, false]) }),
    equipment: list(snapshotEquipment(item, equipmentSets), 19).map((slot) => {
      record(slot);
      const slotId = integer(slot.slot, 19);
      if (slotId < 1) fail();
      return {
        slot: slotId,
        itemId: integer(slot.itemId, 1000000000),
        ...(slot.enchantId == null ? {} : { enchantId: integer(slot.enchantId, 999999999) }),
        ...(slot.transmogItemId == null ? {} : { transmogItemId: integer(slot.transmogItemId, 1000000000) }),
        link: optionalString(slot.link, 2048),
        ...(slot.icon == null ? {} : { icon: integer(slot.icon, 1000000000) }),
        ...(slot.quality == null ? {} : { quality: integer(slot.quality, 8) }),
        ...(slot.tooltip == null ? {} : {
          tooltip: list(slot.tooltip, 20).map((line) => {
            record(line);
            return {
              text: string(line.text, 300),
              ...(line.right == null ? {} : { right: string(line.right, 300) }),
              ...(line.effect === true ? { effect: true } : {}),
            };
          }),
        }),
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
      "honor-points-gain",
      "honor-points-loss",
      "death",
      "player-kill",
      "session-start",
      "session-end",
      "counter-reset",
    ]);
    const isHonorPoints = type === "honor-points-gain" || type === "honor-points-loss";
    const amount = integer(item.amount, isHonorPoints ? 100000000 : 1000000);
    if (type === "honor-gain" || isHonorPoints ? amount < 1 : amount !== 0) fail();
    const cause = type === "death"
      ? oneOf(item.cause ?? "unknown", ["unknown", "pvp", "pve", "environment", "self"])
      : "unknown";
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
      cause,
      ...(type === "player-kill" && item.victim != null ? { victim: string(item.victim) } : {}),
      ...(type === "player-kill" && item.byPet === true ? { byPet: true } : {}),
      ...(cause !== "unknown" && item.source != null ? { source: string(item.source) } : {}),
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
  return playerKey(character);
}
