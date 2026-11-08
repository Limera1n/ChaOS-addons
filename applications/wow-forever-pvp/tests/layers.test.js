import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalLinkKey, identityRuleset, playerKey, scopeLabel } from "../client/identity.js";
import { guildKey, listGuilds, summarize, summarizeGuild } from "../client/model.js";
import { createTrackerStore } from "../server/store.js";
import { validateImport } from "../server/import-schema.js";

function batch(name = "Aelyra", realm = "CAMWOW EU4 Realm 4 PvP", sourceId = "installation-a") {
  return { format: "chaos-world-pvp", version: 1, sourceId, addonVersion: "0.5.8", build: "test", exportedAt: 300,
    character: { name, realm, region: "3", ruleset: "unknown", class: "Mage", level: 60 },
    snapshots: [{ id: "1", at: 100, guild: "Carré Tiananmen", lifetimeHK: 50, equipment: [] }],
    events: [{ id: "2", at: 120, type: "honor-gain", amount: 5, context: "world" }] };
}
function temporary(t) {
  const path = mkdtempSync(join(tmpdir(), "wow-layer-test-"));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}
function legacyCharacter(input) {
  const normalized = validateImport(input);
  return { ...normalized.character, name: input.character.name, ruleset: input.character.ruleset,
    key: JSON.stringify([input.character.region, input.character.ruleset, input.character.realm, input.character.name]),
    metadataAt: Math.max(...input.snapshots.map((item) => item.at)), lastImportedAt: 400,
    ...Object.fromEntries(["snapshots", "events"].map((kind) => [kind, normalized[kind].map((item) => ({ ...item,
      sourceKey: JSON.stringify([input.sourceId, item.id]), sourceId: input.sourceId, addonVersion: input.addonVersion, build: input.build }))])) };
}

test("Forever characters and guilds use region and ruleset across CAMWOW layers", () => {
  const a = batch().character;
  const b = { ...a, realm: "CAMWOW EU4 Realm 6 PvP" };
  const c = { ...a, realm: "CAMWOW EU5 Realm 6 PvP" };
  assert.equal(playerKey(a), playerKey(b));
  assert.equal(playerKey(a), playerKey(c));
  assert.equal(identityRuleset(a), "pvp");
  assert.equal(scopeLabel(a), "EU · PvP");
  assert.equal(playerKey(a), playerKey({ ...b, name: `${a.name}-${b.realm}` }));
  assert.notEqual(playerKey(a), playerKey({ ...b, ruleset: "pve" }));
  assert.notEqual(playerKey(a), playerKey({ ...b, region: "1" }));
  assert.notEqual(playerKey(a), playerKey({ ...b, ruleset: "hardcore" }));
  assert.equal(playerKey(a), playerKey({ ...b, ruleset: "PVP" }));
  const chars = [a, b, c].map((item, i) => ({ ...item, name: `Member${i}`, key: playerKey(item),
    snapshots: batch().snapshots, events: batch().events }));
  const guilds = listGuilds(chars);
  assert.equal(guilds.length, 1);
  const summary = summarizeGuild(chars, guilds[0]);
  assert.equal(summary.currentMembers, 3);
  assert.equal(summary.lifetimeHK, 150);
  assert.equal(summary.history.total, 15);
  const otherRuleset = { ...chars[0], ruleset: "pve" };
  const otherRegion = { ...chars[0], region: "1" };
  const populations = [...chars, otherRuleset, otherRegion];
  assert.equal(listGuilds(populations).length, 3);
  assert.equal(summarizeGuild(populations, guilds[0]).history.total, 15);
  assert.equal(canonicalLinkKey(JSON.stringify([a.region, "unknown", b.realm, "Carré Tiananmen"])), guildKey(a, "Carré Tiananmen"));
  assert.equal(canonicalLinkKey(JSON.stringify([a.region, "unknown", b.realm, a.name]), "player"), playerKey(a));
  assert.equal(canonicalLinkKey("invalid"), "invalid");
});

test("new imports remain one profile when a player changes layer, without duplicate gains", (t) => {
  const store = createTrackerStore({ dataDir: temporary(t) });
  const first = batch();
  store.importBatch(first);
  const second = batch("Aelyra", "CAMWOW EU5 Realm 6 PvP");
  second.snapshots.push({ id: "3", at: 200, guild: "Carré Tiananmen", lifetimeHK: 60, playedSeconds: 90061, playedAt: 200, equipment: [] });
  second.events.push({ id: "4", at: 220, type: "honor-gain", amount: 10, context: "world" });
  assert.equal(store.importBatch(second).added, 2);
  assert.equal(store.importBatch(first).added, 0);
  const [character] = store.read().characters;
  assert.equal(store.read().characters.length, 1);
  assert.equal(character.ruleset, "pvp");
  assert.equal(character.realm, second.character.realm, "Keep the original client label for provenance only");
  assert.equal(summarize(character).worldHK, 15);
  assert.equal(summarize(character).playedSeconds, 90061);
});

test("previous layer-split profiles merge on load, preserving observations and optional metadata", (t) => {
  const dataDir = temporary(t);
  const first = batch();
  const second = batch("Aelyra", "CAMWOW EU5 Realm 6 PvP");
  second.snapshots[0].playedSeconds = 80000;
  second.snapshots[0].playedAt = 100;
  second.snapshots.push({ id: "3", at: 200, guild: "Carré Tiananmen", lifetimeHK: 60, equipment: [] });
  second.events.push({ id: "4", at: 220, type: "honor-gain", amount: 10, context: "world" });
  const bob = batch("Thorgal", "CAMWOW EU4 Realm 6 PvP", "installation-b");
  const file = join(dataDir, "tracker.json");
  const legacy = JSON.stringify({ version: 1, characters: [first, second, bob].map(legacyCharacter) });
  writeFileSync(file, legacy);
  const store = createTrackerStore({ dataDir });
  assert.equal(readFileSync(file, "utf8"), legacy, "Read-time migration must not overwrite the source file");
  const characters = store.read().characters;
  assert.equal(characters.length, 2);
  const player = characters.find((item) => item.name === "Aelyra");
  assert.equal(player.snapshots.length, 2);
  assert.equal(player.events.length, 2);
  assert.equal(player.snapshots[0].playedSeconds, 80000);
  assert.equal(player.ruleset, "pvp");
  assert.equal(summarize(player).worldHK, 15);
  assert.equal(listGuilds(characters).length, 1);
  assert.equal(summarizeGuild(characters, listGuilds(characters)[0]).history.total, 20);
  assert.equal(store.importBatch(first).added, 0);
  assert.equal(store.importBatch(second).added, 0);
  assert.equal(createTrackerStore({ dataDir }).read().characters.length, 2);
});

test("a migration conflict never silently discards or overwrites an existing observation", (t) => {
  const dataDir = temporary(t);
  const first = batch();
  const second = batch("Aelyra", "CAMWOW EU4 Realm 6 PvP");
  second.events[0].amount = 99;
  const file = join(dataDir, "tracker.json");
  const source = JSON.stringify({ version: 1, characters: [first, second].map(legacyCharacter) });
  writeFileSync(file, source);
  assert.throws(() => createTrackerStore({ dataDir }), /Conflit/);
  assert.equal(readFileSync(file, "utf8"), source);
});
