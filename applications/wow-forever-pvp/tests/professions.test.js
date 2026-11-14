import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateImport } from "../server/import-schema.js";
import { createTrackerStore } from "../server/store.js";
import { createLocalServer } from "../server/local-server.js";
import { professionsPanel, bindProfessionSearch } from "../client/professions.js";

const professions = () => ({ at: 100, items: [{ skillLineId: 164, name: "Forge", rank: 150, maxRank: 300,
  recipesAt: 90, recipes: [{ id: 123, name: "Épée", available: 0 }, { id: 124, name: "Bottes" }] }] });
const batch = () => ({ format: "chaos-world-pvp", version: 1, sourceId: "test", addonVersion: "0.5.15", build: "test", exportedAt: 200,
  character: { name: "Smith", realm: "Realm", region: "3", ruleset: "pvp" },
  snapshots: [{ id: "1", at: 100, equipment: [] }], events: [], professions: professions() });

test("professions persist across restart and old or legacy exports cannot replace a newer reading", (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "professions-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const store = createTrackerStore({ dataDir });
  store.importBatch(batch());
  assert.equal(store.importBatch(batch()).added, 0);
  const older = batch(); older.professions.at = 95; older.professions.items = [];
  store.importBatch(older);
  const legacy = batch(); delete legacy.professions; store.importBatch(legacy);
  assert.deepEqual(createTrackerStore({ dataDir }).read().characters[0].professions, professions());
  const abandoned = batch(); abandoned.professions = { at: 110, items: [] };
  store.importBatch(abandoned);
  assert.deepEqual(store.read().characters[0].professions.items, []);
});

test("profession validation rejects invalid levels, duplicates, future dates and incomplete recipe scans", () => {
  for (const mutate of [
    (p) => p.at = 201,
    (p) => p.items[0].rank = -1,
    (p) => p.items[0].rank = 301,
    (p) => p.items.push(p.items[0]),
    (p) => p.items[0].recipesAt = 101,
    (p) => delete p.items[0].recipesAt,
    (p) => p.items[0].recipes[0].available = -1,
    (p) => p.items[0].recipes[0].available = 1.5,
    (p) => p.items[0].recipes.push(p.items[0].recipes[0]),
    (p) => p.items[0].recipes = Array(5001).fill({ id: 1, name: "x" }),
  ]) {
    const input = batch(); mutate(input.professions);
    assert.throws(() => validateImport(input), /invalide/);
  }
  const unknown = batch(); delete unknown.professions.items[0].recipes; delete unknown.professions.items[0].recipesAt;
  assert.equal(validateImport(unknown).professions.items[0].recipes, undefined);
});

test("profession panel escapes names and distinguishes missing recipes, quantities and zero", () => {
  const data = professions(); data.items[0].recipes[0].name = '<img src=x onerror="bad()">';
  const html = professionsPanel(data);
  assert.ok(!html.includes('<img'));
  assert.match(html, /&lt;img/);
  assert.match(html, /<td>0<\/td>/);
  assert.match(html, /Non relevée/);
  assert.match(professionsPanel(null), /Métiers non relevés/);
  delete data.items[0].recipes; delete data.items[0].recipesAt;
  assert.match(professionsPanel(data), /Recettes non relevées/);
  assert.match(professionsPanel({ at: 100, items: [] }), /Aucun métier appris/);
});

test("recipe search filters rows and shows the empty state", () => {
  let search;
  const rows = [{ dataset: { recipeName: "épée" } }, { dataset: { recipeName: "bottes" } }];
  const empty = {};
  const card = { querySelectorAll: () => rows, querySelector: () => empty };
  bindProfessionSearch({ querySelector: () => ({ addEventListener: (_, fn) => search = fn }), querySelectorAll: () => [card] });
  search({ target: { value: " ÉPÉE " } });
  assert.deepEqual(rows.map((row) => row.hidden), [false, true]);
  assert.equal(empty.hidden, true);
  search({ target: { value: "rien" } });
  assert.equal(empty.hidden, false);
  search({ target: { value: "" } });
  assert.ok(rows.every((row) => !row.hidden));
});

test("local server serves the profession module", async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "profession-http-"));
  const server = createLocalServer({ dataDir });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); rmSync(dataDir, { recursive: true, force: true }); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/professions.js`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /export function professionsPanel/);
});
