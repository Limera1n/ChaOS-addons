import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTrackerStore } from "../server/store.js";

function batch() {
  return { format: "chaos-world-pvp", version: 1, sourceId: "rounding-test", addonVersion: "0.5.2", build: "test", exportedAt: 300,
    character: { name: "Test", region: "3", realm: "CAMWOW EU5 Realm 6 PvP", ruleset: "unknown" },
    snapshots: [{ id: "1", at: 100, lifetimeHK: 10, equipment: [] }],
    events: [{ id: "81", at: 200, type: "honor-gain", amount: 1, context: "world",
      location: { mapId: 1440, zone: "Ashenvale", at: 200, x: 0.46394413709641, y: 0.64209318161011 } }] };
}
function storeFor(t) {
  const dataDir = mkdtempSync(join(tmpdir(), "wow-rounding-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  return { store: createTrackerStore({ dataDir }), dataDir };
}

test("reimports tolerate Lua coordinate serialization rounding without overwriting readings or adding VH", (t) => {
  const { store, dataDir } = storeFor(t);
  const old = batch();
  store.importBatch(old);
  const newer = batch();
  newer.addonVersion = "0.5.7";
  newer.events[0].location.x = 0.4639441370964;
  newer.events[0].location.y += 1e-14;
  assert.equal(store.importBatch(newer).added, 0);
  assert.equal(store.importBatch(old).added, 0);
  const result = createTrackerStore({ dataDir }).read().characters[0];
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].amount, 1);
  assert.deepEqual(result.events[0].location, old.events[0].location);
});

test("real event changes still conflict and identify the offending event atomically", (t) => {
  const { store } = storeFor(t);
  store.importBatch(batch());
  const before = store.read();
  const changes = [
    (item) => { item.amount = 2; },
    (item) => { item.at++; },
    (item) => { item.context = "pvp"; },
    (item) => { item.location.x += 0.001; },
    (item) => { item.location.mapId++; },
    (item) => { item.location.zone = "Other"; },
    (item) => { item.location.at--; },
    (item) => { delete item.location.x; delete item.location.y; },
  ];
  for (const change of changes) {
    const changed = batch();
    changed.events[0].location.y += 1e-14;
    change(changed.events[0]);
    assert.throws(() => store.importBatch(changed), /Conflit.*81/);
    assert.deepEqual(store.read(), before);
  }
});
