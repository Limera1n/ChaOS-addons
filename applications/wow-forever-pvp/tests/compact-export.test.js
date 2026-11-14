import { test } from "node:test";
import assert from "node:assert/strict";
import { validateImport } from "../server/import-schema.js";

function batch() {
  return { format: "chaos-world-pvp", version: 1, sourceId: "compact-test", addonVersion: "0.5.9", build: "test", exportedAt: 300,
    character: { name: "Test", region: "3", realm: "CAMWOW EU4 Realm 4 PvP", ruleset: "pvp" },
    snapshots: [100, 200].map((at, index) => ({ id: String(index), at, lifetimeHK: index * 2, equipment: [{ slot: 1, itemId: 123, quality: 2 }] })), events: [] };
}

test("compact loadout references expand to the same observations as legacy exports", () => {
  const legacy = batch();
  const compact = structuredClone(legacy);
  compact.equipmentSets = [compact.snapshots[0].equipment];
  compact.snapshots = compact.snapshots.map(({ equipment, ...snapshot }) => ({ ...snapshot, equipmentRef: 0 }));
  const result = validateImport(compact);
  assert.deepEqual(result, validateImport(legacy));
  result.snapshots[0].equipment[0].itemId = 999;
  assert.equal(result.snapshots[1].equipment[0].itemId, 123, "Expanded snapshots must not share mutable item objects");
  for (const invalid of [-1, 1, "0", .5]) {
    const input = structuredClone(compact);
    input.snapshots[0].equipmentRef = invalid;
    assert.throws(() => validateImport(input), /Export invalide/);
  }
  compact.snapshots[0].equipment = [];
  assert.throws(() => validateImport(compact), /Export invalide/);
});

test("item and stat dictionaries preserve observations and reject invalid references", () => {
  const legacy = batch();
  for (const item of legacy.snapshots) item.stats = { health: 123 };
  const compact = structuredClone(legacy);
  compact.equipmentItems = [compact.snapshots[0].equipment[0]];
  compact.equipmentSets = [[0]];
  compact.statsSets = [compact.snapshots[0].stats];
  compact.snapshots = compact.snapshots.map(({ equipment, stats, ...item }) => ({ ...item, equipmentRef: 0, statsRef: 0 }));
  assert.deepEqual(validateImport(compact), validateImport(legacy));
  const expanded = validateImport(compact);
  expanded.snapshots[0].stats.health = 999;
  expanded.snapshots[0].equipment[0].itemId = 999;
  assert.equal(expanded.snapshots[1].stats.health, 123);
  assert.equal(expanded.snapshots[1].equipment[0].itemId, 123);
  for (const invalid of [-1, 1, "0", .5, {}, null]) {
    const input = structuredClone(compact);
    input.equipmentSets[0][0] = invalid;
    assert.throws(() => validateImport(input), /Export invalide/);
  }
  for (const invalid of [-1, 1, "0", .5, {}]) {
    const input = structuredClone(compact);
    input.snapshots[0].statsRef = invalid;
    assert.throws(() => validateImport(input), /Export invalide/);
  }
  const missing = structuredClone(compact);
  delete missing.statsSets;
  assert.throws(() => validateImport(missing), /Export invalide/);
  compact.snapshots[0].stats = {};
  assert.throws(() => validateImport(compact), /Export invalide/);
});
