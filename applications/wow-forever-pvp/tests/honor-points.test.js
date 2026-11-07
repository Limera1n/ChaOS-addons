import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateImport } from "../server/import-schema.js";
import { createTrackerStore } from "../server/store.js";
import { summarize } from "../client/model.js";

function batch() {
  return {
    format: "chaos-world-pvp", version: 1, sourceId: "honor-test",
    addonVersion: "0.5.5", build: "simulated", exportedAt: 200,
    character: { name: "Tester", realm: "Test", region: "3", ruleset: "unknown" },
    snapshots: [{ id: "1", at: 100, lifetimeHK: 10, equipment: [] }],
    events: [],
  };
}

test("honor balance, gains and losses persist without changing HK or old imports", (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "chaos-honor-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const store = createTrackerStore({ dataDir });
  const legacy = batch();
  store.importBatch(legacy);
  const input = batch();
  input.snapshots.push({ id: "2", at: 200, honorPoints: 0, lifetimeHK: 11, equipment: [] });
  input.events = [
    { id: "3", at: 150, type: "honor-points-gain", amount: 50, context: "world" },
    { id: "4", at: 160, type: "honor-points-gain", amount: 25, context: "pvp" },
    { id: "5", at: 170, type: "honor-points-loss", amount: 75, context: "world" },
    { id: "6", at: 180, type: "honor-gain", amount: 1, context: "world" },
  ];
  assert.equal(store.importBatch(input).added, 5);
  assert.equal(store.importBatch(input).added, 0);
  assert.equal(store.importBatch(legacy).added, 0);
  const character = createTrackerStore({ dataDir }).read().characters[0];
  const summary = summarize(character);
  assert.equal(summary.honorPoints, 0);
  assert.equal(summary.honorAt, 200);
  assert.equal(summary.honorGained, 75);
  assert.equal(summary.honorLost, 75);
  assert.equal(summary.worldHonor, 50);
  assert.equal(summary.worldHK, 1);
  assert.equal(summary.lifetimeHK, 11);
  assert.equal(summary.events.length, 1, "Honor currency must not become an HK map marker");
  const changed = structuredClone(input);
  changed.snapshots[1].honorPoints = 1;
  assert.throws(() => store.importBatch(changed), /Conflit/);
});

test("unknown honor remains missing and a later unreadable snapshot preserves its date", () => {
  const input = batch();
  let summary = summarize(input);
  assert.equal(summary.honorPoints, null);
  assert.equal(summary.honorGained, null);
  assert.equal(summary.worldHonor, null);
  input.snapshots[0].honorPoints = 42;
  input.snapshots.push({ id: "2", at: 200, equipment: [] });
  summary = summarize(input);
  assert.equal(summary.honorPoints, 42);
  assert.equal(summary.honorAt, 100);
  assert.equal(summary.honorGained, 0);
});

test("honor import rejects invalid balances and invalid currency event amounts", () => {
  for (const value of [-1, 0.5, "12", 100000001]) {
    const input = batch();
    input.snapshots[0].honorPoints = value;
    assert.throws(() => validateImport(input), /invalide/);
  }
  for (const type of ["honor-points-gain", "honor-points-loss"]) {
    for (const amount of [0, -2, 1.5, 100000001]) {
      const input = batch();
      input.events.push({ id: "2", at: 150, type, amount, context: "world" });
      assert.throws(() => validateImport(input), /invalide/);
    }
  }
});
