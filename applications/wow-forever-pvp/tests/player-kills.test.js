import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateImport } from "../server/import-schema.js";
import { createTrackerStore } from "../server/store.js";
import { filterDeaths, groupZones, honorProgress, killLabel, summarize } from "../client/model.js";

function batch() {
  return {
    format: "chaos-world-pvp", version: 1, sourceId: "kills-test",
    addonVersion: "0.5.6", build: "simulated", exportedAt: 200,
    character: { name: "Tester", realm: "Test", region: "3", ruleset: "unknown" },
    snapshots: [{ id: "1", at: 100, lifetimeHK: 10, equipment: [] }],
    events: [
      { id: "2", at: 150, type: "player-kill", amount: 0, context: "world", victim: "Enemy-Realm" },
      { id: "3", at: 151, type: "honor-gain", amount: 1, context: "world" },
      { id: "4", at: 160, type: "player-kill", amount: 0, context: "world", byPet: true },
      { id: "5", at: 170, type: "player-kill", amount: 0, context: "pvp", victim: "BG Enemy" },
    ],
  };
}

test("named kills persist and deduplicate without inflating HK or honor", (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "chaos-kills-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const store = createTrackerStore({ dataDir });
  assert.equal(store.importBatch(batch()).added, 5);
  assert.equal(store.importBatch(batch()).added, 0);
  const character = createTrackerStore({ dataDir }).read().characters[0];
  assert.equal(character.events[0].victim, "Enemy-Realm");
  assert.equal(character.events[2].byPet, true);
  const summary = summarize(character);
  assert.equal(summary.kills, 2);
  assert.equal(summary.worldHK, 1);
  assert.equal(summary.honorGained, null);
  assert.equal(summary.deaths, 0);
  assert.equal(summary.events.length, 3);
  assert.equal(honorProgress([character]).total, 1);
  assert.deepEqual(groupZones(summary.events)[0], {
    key: "unknown", name: "Zone inconnue", hk: 1, deaths: 0, kills: 2,
  });
  assert.equal(filterDeaths(summary.events, "pvp").length, 3);
  const changed = batch();
  changed.events[0].victim = "Another player";
  assert.throws(() => store.importBatch(changed), /Conflit/);
});

test("kill labels identify the victim and distinguish a pet's fatal blow", () => {
  assert.equal(killLabel({ victim: "Enemy-Realm" }), "Joueur tué · Enemy-Realm · coup fatal personnel");
  assert.equal(killLabel({ byPet: true }), "Joueur tué · nom indisponible · coup fatal du familier");
});

test("kill imports reject invalid names and never treat kill events as VH", () => {
  for (const victim of ["", "x".repeat(161), "A\nB", 12]) {
    const input = batch();
    input.events[0].victim = victim;
    assert.throws(() => validateImport(input), /invalide/);
  }
  const input = batch();
  input.events[0].amount = 1;
  assert.throws(() => validateImport(input), /invalide/);
  const legacy = batch();
  legacy.events = [legacy.events[1]];
  const clean = validateImport(legacy);
  assert.equal(clean.events[0].victim, undefined);
  assert.equal(summarize(clean).kills, 0);
});
