import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateImport } from "../server/import-schema.js";
import { createTrackerStore } from "../server/store.js";
import { createLocalServer } from "../server/local-server.js";
import { talentsPanel, talentLayout, talentPoints, talentBranches, bindTalents } from "../client/talents.js";

function build(at = 100) {
  return { at, configId: 1, name: "Build actif", trees: [{ id: 2, name: "Combat", nodes: [
    { id: 10, x: -100, y: 20, rank: 2, maxRank: 5, spent: 1, activeEntryId: 101,
      entries: [{ id: 100, name: "Option" }, { id: 101, name: "Frappe", spellId: 123, icon: 456 }], edges: [20] },
    { id: 20, x: 100, y: 500, rank: 0, maxRank: 1, spent: 0, entries: [{ id: 200, name: "Protection" }], edges: [] },
  ] }] };
}
function batch() {
  return { format: "chaos-world-pvp", version: 1, sourceId: "talent-test", addonVersion: "0.5.16", build: "test", exportedAt: 200,
    character: { name: "Talent", realm: "Realm", region: "3", ruleset: "pvp" },
    snapshots: [{ id: "1", at: 100, equipment: [] }], events: [], talents: build() };
}

test("talent builds persist, update after a respec and survive old and legacy imports", (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "talents-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const store = createTrackerStore({ dataDir });
  store.importBatch(batch());
  assert.equal(store.importBatch(batch()).added, 0);
  const newer = batch(); newer.talents = build(150); newer.talents.trees[0].nodes[0].rank = 0;
  newer.talents.trees[0].nodes[0].spent = 0; delete newer.talents.trees[0].nodes[0].activeEntryId;
  store.importBatch(newer);
  store.importBatch(batch());
  const legacy = batch(); delete legacy.talents; store.importBatch(legacy);
  assert.deepEqual(createTrackerStore({ dataDir }).read().characters[0].talents, newer.talents);
});

test("talent validation bounds trees and rejects corrupt ranks, choices, links and dates", () => {
  assert.deepEqual(validateImport(batch()).talents, build());
  for (const mutate of [
    (b) => b.at = 201,
    (b) => b.configId = 0,
    (b) => b.trees = [],
    (b) => b.trees.push(b.trees[0]),
    (b) => b.trees[0].nodes.push(b.trees[0].nodes[0]),
    (b) => b.trees[0].nodes[0].x = Infinity,
    (b) => b.trees[0].nodes[0].y = "100",
    (b) => b.trees[0].nodes[0].rank = 6,
    (b) => b.trees[0].nodes[0].spent = 3,
    (b) => b.trees[0].nodes[0].activeEntryId = 999,
    (b) => delete b.trees[0].nodes[0].activeEntryId,
    (b) => b.trees[0].nodes[0].edges = [999],
    (b) => b.trees[0].nodes[0].edges = [10],
    (b) => b.trees[0].nodes[0].entries = [],
    (b) => b.trees[0].nodes[0].entries[0].name = "bad\u0000name",
    (b) => b.trees[0].nodes = Array(1001).fill(b.trees[0].nodes[0]),
  ]) {
    const input = batch(); mutate(input.talents);
    assert.throws(() => validateImport(input), /invalide/);
  }
});

test("tree layout preserves ordering and rank totals exclude granted ranks", () => {
  const tree = build().trees[0], layout = talentLayout(tree);
  assert.equal(talentPoints(tree), 1);
  assert.ok(layout.nodes[0].left < layout.nodes[1].left);
  assert.ok(layout.nodes[0].top < layout.nodes[1].top);
  const html = talentsPanel(build());
  assert.match(html, /talent-edge/);
  assert.match(html, /2\/5/);
  assert.match(html, /Frappe/);
  assert.match(html, /1 rang\(s\) accordé\(s\)/);
  assert.match(html, /0\/1/);
  assert.match(html, /viewBox=/);
  assert.match(html, /data-node-id="10"/);
  assert.match(talentsPanel(null), /Build non relevé/);
  const unsafe = build(); unsafe.name = '<script>bad()</script>'; unsafe.trees[0].nodes[0].entries[1].name = '" onfocus="bad()';
  assert.ok(!talentsPanel(unsafe).includes('<script>'));
  assert.match(talentsPanel(unsafe), /&quot; onfocus=&quot;/);
});

test("talent descriptions survive validation and reject oversized or protected text", () => {
  const input = batch();
  input.talents.trees[0].nodes[0].entries[1].description = "Inflige des dégâts.";
  assert.deepEqual(validateImport(input).talents, input.talents);
  for (const description of ["x".repeat(3001), "bad\u0000"]) {
    input.talents.trees[0].nodes[0].entries[1].description = description;
    assert.throws(() => validateImport(input), /invalide/);
  }
});

test("classic legacy trees become three four-column branches without losing nodes, points or links", () => {
  const tree = { id: 2, nodes: Array.from({ length: 84 }, (_, i) => ({ id: i + 1, x: (i % 12) * 100, y: Math.floor(i / 12) * 100,
    rank: i % 12 >= 8 ? 1 : 0, maxRank: 1, spent: i % 12 >= 8 ? 1 : 0,
    entries: [{ id: i + 1, name: `Talent ${i + 1}` }], edges: i < 72 ? [i + 13] : [] })) };
  const groups = talentBranches(tree, "Mage");
  assert.deepEqual(groups.map((group) => group.name), ["Arcanes", "Feu", "Givre"]);
  assert.deepEqual(groups.map(talentPoints), [0, 0, 28]);
  assert.equal(new Set(groups.flatMap((group) => group.nodes.map((node) => node.id))).size, 84);
  for (const group of groups) {
    assert.equal(talentLayout(group).width, 352);
    assert.equal(group.id, tree.id, "tooltip lookup keeps the original tree ID");
    assert.ok(group.nodes.every((node) => node.edges.every((id) => group.nodes.some((target) => target.id === id))));
  }
  const html = talentsPanel({ at: 100, trees: [tree] }, "Mage");
  assert.equal((html.match(/class="talent-tree /gu) ?? []).length, 3);
  assert.match(html, /marker-end="url\(#talent-arrow-/);
  assert.equal(new Set([...html.matchAll(/id="(talent-arrow-[^"]+)"/gu)].map((match) => match[1])).size, 3);
  tree.nodes[0].edges.push(9);
  assert.equal(talentBranches(tree, "Mage").length, 1, "cross-branch dependencies are never hidden");
});

test("exported branch metadata preserves names, order, icons and empty tiers", () => {
  const input = batch(), tree = input.talents.trees[0];
  tree.groups = [{ id: 2, name: "Givre", order: 2, icon: 123 }, { id: 1, name: "Feu", order: 1, icon: 456 }];
  tree.nodes[0].groupId = 1; tree.nodes[0].edges = []; tree.nodes[1].groupId = 2;
  assert.deepEqual(validateImport(input).talents, input.talents);
  const branches = talentBranches(tree);
  assert.deepEqual(branches.map((group) => group.name), ["Feu", "Givre"]);
  assert.deepEqual(branches.map((group) => group.icon), [456, 123]);
  assert.equal(talentLayout(branches[0]).height, talentLayout(branches[1]).height);
  assert.ok(talentLayout(branches[0]).nodes[0].top < talentLayout(branches[1]).nodes[0].top);
  for (const mutate of [
    (tree) => tree.nodes[0].groupId = 999,
    (tree) => delete tree.groups,
    (tree) => tree.groups.push(tree.groups[0]),
    (tree) => tree.groups[0].icon = -1,
    (tree) => tree.groups[0].name = "bad\u0000",
  ]) {
    const bad = structuredClone(input); mutate(bad.talents.trees[0]);
    assert.throws(() => validateImport(bad), /invalide/);
  }
});

test("keyboard focus and touch expose the same talent detail as hover", () => {
  const handlers = {}, info = {};
  const node = { getAttribute: () => "Frappe · rang 2/5", addEventListener: (name, fn) => handlers[name] = fn };
  bindTalents({ querySelectorAll: () => [{ querySelector: () => info, querySelectorAll: () => [node] }] });
  for (const name of ["focus", "pointerenter", "click"]) { info.textContent = ""; handlers[name](); assert.equal(info.textContent, "Frappe · rang 2/5"); }
});

test("local HTTP serves the talent module and retains talents through a real import", async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "talents-http-"));
  const server = createLocalServer({ dataDir });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}/`;
  assert.equal((await fetch(base + "talents.js")).status, 200);
  const response = await fetch(base + "api/wow-forever-pvp/import", { method: "POST", headers: { "Content-Type": "application/vnd.chaos-world-pvp+json", Origin: base.slice(0, -1) }, body: JSON.stringify(batch()) });
  assert.equal(response.status, 200);
  const state = await (await fetch(base + "api/wow-forever-pvp/state")).json();
  assert.deepEqual(state.characters[0].talents, build());
});
