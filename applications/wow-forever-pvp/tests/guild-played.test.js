import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatPlayed, guildKey, listGuilds, summarize, summarizeGuild } from "../client/model.js";
import { validateImport } from "../server/import-schema.js";
import { createTrackerStore } from "../server/store.js";

function character(name, guild = "Guild", realm = "Realm") {
  return { key: name + realm, name, region: "3", ruleset: "unknown", realm,
    snapshots: [{ id: "1", at: 100, lifetimeHK: 100, guild, equipment: [] }], events: [] };
}
function gain(at, amount, context = "world") {
  return { id: String(at), at, amount, type: "honor-gain", context };
}

test("guild page combines every imported member, all contexts, without crossing realm or membership boundaries", () => {
  const alice = character("Alice");
  alice.events = [gain(90, 99), gain(120, 2), gain(160, 3, "pvp"), gain(190, 50)];
  alice.snapshots.push({ id: "2", at: 180, lifetimeHK: 200, guild: "Other", equipment: [] });
  const bob = character("Bob");
  bob.events = [gain(120, 4), gain(170, 6, "unknown")];
  bob.snapshots.push({ id: "2", at: 200, lifetimeHK: 150, guild: "Guild", equipment: [] });
  const elsewhere = character("Elsewhere", "Guild", "Other realm");
  elsewhere.events = [gain(120, 500)];
  const unknown = character("Unknown");
  unknown.snapshots[0].lifetimeHK = null;
  const data = [alice, bob, elsewhere, unknown];
  const guilds = listGuilds(data);
  assert.equal(guilds.length, 3);
  const guild = guilds.find((item) => item.key === guildKey(bob, "Guild"));
  const summary = summarizeGuild(data, guild);
  assert.equal(summary.history.total, 15);
  assert.equal(summary.worldHistory.total, 6);
  assert.deepEqual(summary.history.points, [{ at: 120, total: 6 }, { at: 160, total: 9 }, { at: 170, total: 15 }]);
  assert.equal(summary.lifetimeHK, 150, "Only current members' latest known counters contribute to the lifetime sum");
  assert.equal(summary.currentMembers, 2);
  assert.equal(summary.knownCounters, 1);
  assert.equal(summary.members.find((member) => member.character.name === "Alice").current, false);
  assert.equal(summary.members.find((member) => member.character.name === "Bob").history.total, 10);
  assert.equal(summarizeGuild([unknown], guild).lifetimeHK, null);
  assert.equal(summarizeGuild([bob], guild).history.total, 10, "A single-member guild honestly has that member's gains");
});

function batch() {
  return { format: "chaos-world-pvp", version: 1, sourceId: "test", addonVersion: "0.5.7", build: "test", exportedAt: 200,
    character: { name: "Played", realm: "Realm", region: "3", ruleset: "unknown" },
    snapshots: [{ id: "1", at: 100, playedSeconds: 90061, playedAt: 90, equipment: [] }], events: [] };
}

test("played time survives import, reimport and restart, with its measurement date and legacy fallback", (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "played-test-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const store = createTrackerStore({ dataDir });
  const legacy = batch();
  delete legacy.snapshots[0].playedSeconds;
  delete legacy.snapshots[0].playedAt;
  store.importBatch(legacy);
  assert.equal(summarize(store.read().characters[0]).playedSeconds, null);
  assert.equal(store.importBatch(batch()).added, 0);
  store.importBatch(legacy);
  const result = summarize(createTrackerStore({ dataDir }).read().characters[0]);
  assert.equal(result.playedSeconds, 90061);
  assert.equal(result.playedAt, 90);
  assert.equal(formatPlayed(result.playedSeconds), "1 j 1 h 1 min");
  assert.equal(formatPlayed(0), "0 j 0 h 0 min");
  assert.equal(formatPlayed(null), "Non relevé");
  const changed = batch();
  changed.snapshots[0].playedSeconds++;
  assert.throws(() => store.importBatch(changed), /Conflit/);
});

test("played import rejects invalid, future or incomplete measurements while preserving zero", () => {
  for (const patch of [
    { playedSeconds: -1 }, { playedSeconds: "1" }, { playedSeconds: 0.5 },
    { playedAt: 101 }, { playedAt: null }, { playedSeconds: null },
  ]) {
    const input = batch();
    Object.assign(input.snapshots[0], patch);
    assert.throws(() => validateImport(input), /Export invalide/);
  }
  const input = batch();
  input.snapshots[0].playedSeconds = 0;
  assert.equal(validateImport(input).snapshots[0].playedSeconds, 0);
});
