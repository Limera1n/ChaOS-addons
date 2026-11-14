import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateImport } from "../server/import-schema.js";
import { createTrackerStore } from "../server/store.js";
import { createLocalServer } from "../server/local-server.js";
import { professionsPanel, bindProfessionSearch, groupRecipes } from "../client/professions.js";

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

test("profession panel escapes names, renders recipe icons and omits craftable quantities", () => {
  const data = professions(); data.items[0].recipes[0].name = '<img src=x onerror="bad()">';
  const html = professionsPanel(data);
  assert.ok(!html.includes('<img src=x'));
  assert.match(html, /&lt;img/);
  assert.ok(!html.includes("Quantité fabricable"));
  assert.ok(!html.includes("<table"));
  assert.match(html, /data-recipe-id="123"/);
  data.items[0].recipes[0].icon = 456;
  assert.match(professionsPanel(data), /icons\/card\/456.jpg/);
  assert.match(professionsPanel(null), /Métiers non relevés/);
  delete data.items[0].recipes; delete data.items[0].recipesAt;
  assert.match(professionsPanel(data), /Recettes non relevées/);
  assert.match(professionsPanel({ at: 100, items: [] }), /Aucun métier appris/);
});

test("recipe visuals and tooltip lines survive validation and storage", (t) => {
  const input = batch();
  Object.assign(input.professions.items[0].recipes[0], { icon: 456, itemId: 789,
    categoryPath: [{ id: 1, name: "Armes", order: 2 }, { id: 2, name: "Épées", order: 1 }],
    reagents: [{ options: [{ itemId: 10940, name: "Strange Dust", quantity: 2, icon: 132858 }] },
      { optional: true, options: [{ currencyId: 55, name: "Monnaie", quantity: 3 }, { itemId: 2589, name: "Cloth", quantity: 6 }] }],
    description: "Fabrique une épée.", tooltip: [{ text: "12 Force", effect: true }, { text: "Main droite", right: "Épée" }] });
  assert.deepEqual(validateImport(input).professions, input.professions);
  const dataDir = mkdtempSync(join(tmpdir(), "recipe-visuals-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  createTrackerStore({ dataDir }).importBatch(input);
  assert.deepEqual(createTrackerStore({ dataDir }).read().characters[0].professions, input.professions);
  for (const invalid of [{ icon: -1 }, { itemId: 0 }, { description: "x".repeat(3001) }, { tooltip: [{ text: "bad\u0000" }] },
    { categoryPath: [] }, { categoryPath: [{ id: 0, name: "x", order: 0 }] },
    { categoryPath: [{ id: 1, name: "bad\u0000", order: 0 }] },
    { categoryPath: [{ id: 1, name: "x", order: -1 }] },
    { categoryPath: Array(9).fill({ id: 1, name: "x", order: 0 }) },
    { categoryPath: Array(2).fill({ id: 1, name: "x", order: 0 }) }]) {
    const bad = batch(); Object.assign(bad.professions.items[0].recipes[0], invalid);
    assert.throws(() => validateImport(bad), /invalide/);
  }
});

test("recipe costs distinguish unknown, free, alternatives and malformed quantities", () => {
  const input = batch(); input.professions.items[0].recipes[0].reagents = [];
  assert.deepEqual(validateImport(input).professions.items[0].recipes[0].reagents, []);
  for (const reagents of [
    [{ options: [] }],
    [{ options: [{ itemId: 1, name: "x", quantity: 0 }] }],
    [{ options: [{ itemId: 1, name: "x", quantity: -2 }] }],
    [{ options: [{ itemId: 1, name: "x", quantity: 1.5 }] }],
    [{ options: [{ itemId: 1, name: "x", quantity: "2" }] }],
    [{ options: [{ itemId: 1, name: "x", quantity: 2, icon: -1 }] }],
    [{ options: [{ itemId: 1, name: "x", quantity: 2, icon: "132858" }] }],
    [{ options: [{ itemId: 1, name: "x", quantity: 1000001 }] }],
    [{ options: [{ name: "x", quantity: 2 }] }],
    [{ options: [{ itemId: 1, currencyId: 2, name: "x", quantity: 2 }] }],
    [{ optional: "false", options: [{ itemId: 1, name: "x", quantity: 2 }] }],
    Array(33).fill({ options: [{ itemId: 1, name: "x", quantity: 2 }] }),
  ]) {
    input.professions.items[0].recipes[0].reagents = reagents;
    assert.throws(() => validateImport(input), /invalide/);
  }
});

test("recipes follow game category order and hierarchy, keeping legacy recipes at the end", () => {
  const armor = { id: 10, name: "Armures", order: 1 }, weapons = { id: 20, name: "Armes", order: 2 };
  const recipes = [
    { id: 1, name: "Épée", categoryPath: [weapons, { id: 21, name: "Épées", order: 1 }] },
    { id: 2, name: "Bottes", categoryPath: [armor, { id: 11, name: "Bottes", order: 2 }] },
    { id: 3, name: "Gants", categoryPath: [armor, { id: 12, name: 'Gants <test>', order: 1 }] },
    { id: 4, name: "Ancienne recette" },
    { id: 5, name: "Bottes renforcées", categoryPath: [armor, { id: 11, name: "Bottes", order: 2 }] },
  ];
  const groups = groupRecipes(recipes);
  assert.deepEqual(groups.map((group) => group.id), [10, 20, "unknown"]);
  assert.deepEqual(groups[0].children.map((group) => group.id), [12, 11]);
  assert.equal(groups[0].count, 3);
  assert.deepEqual(groups[0].children[1].recipes.map((recipe) => recipe.id), [5, 2]);
  assert.deepEqual(recipes.map((recipe) => recipe.id), [1, 2, 3, 4, 5], "display ordering preserves the imported data");
  const data = professions(); data.items[0].recipes = recipes;
  const html = professionsPanel(data);
  assert.match(html, /Gants &lt;test&gt;/);
  assert.ok(html.indexOf("Armures") < html.indexOf(">Armes<"));
  assert.match(html, /data-recipe-category open/);
  assert.match(html, /data-recipe-name="épée armes épées"/);
  assert.match(html, /Catégorie non relevée/);
  assert.equal((html.match(/data-recipe-id=/gu) ?? []).length, recipes.length);
  assert.ok(html.indexOf('data-recipe-id="5"') < html.indexOf('data-recipe-id="2"'));
});

test("recipe search filters rows and shows the empty state", () => {
  let search;
  const rows = [{ dataset: { recipeName: "épée" } }, { dataset: { recipeName: "bottes" } }];
  const empty = {};
  const count = {};
  const category = { open: false, matches: () => true, querySelectorAll: () => rows, querySelector: () => count };
  const book = { open: false, matches: () => false, querySelectorAll: () => rows };
  const card = { querySelectorAll: (selector) => selector === "[data-recipe-name]" ? rows : [book, category], querySelector: () => empty };
  bindProfessionSearch({ querySelector: () => ({ addEventListener: (_, fn) => search = fn }), querySelectorAll: () => [card] });
  search({ target: { value: " ÉPÉE " } });
  assert.deepEqual(rows.map((row) => row.hidden), [false, true]);
  assert.equal(empty.hidden, true);
  assert.equal(category.open, true);
  assert.equal(book.open, true);
  assert.equal(count.textContent, 1);
  search({ target: { value: "rien" } });
  assert.equal(empty.hidden, false);
  assert.equal(category.hidden, true);
  search({ target: { value: "" } });
  assert.ok(rows.every((row) => !row.hidden));
  assert.equal(category.open, false, "clearing search restores collapsed categories");
  assert.equal(book.open, false);
  assert.equal(category.hidden, false);
  assert.equal(count.textContent, 2);
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
