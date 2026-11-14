import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateImport } from "../server/import-schema.js";
import { createTrackerStore } from "../server/store.js";
import { createLocalServer } from "../server/local-server.js";
import { statKeys, formatStat } from "../client/character-stats.js";

const batch = () => ({
  format: "chaos-world-pvp", version: 1, sourceId: "stats-test",
  addonVersion: "0.5.13", build: "simulated", exportedAt: 200,
  character: { name: "Tester", realm: "Test", region: "3", ruleset: "pvp", raceId: 3, sex: 2 },
  snapshots: [{ id: "1", at: 100, equipment: [], stats: { strength: 100, meleeHit: 0, spellHit: -1, attackSpeed: 2.6 } }], events: [],
});

test("effective stats retain zero, signed modifiers and decimals across reimport and restart", (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "chaos-stats-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const store = createTrackerStore({ dataDir });
  const input = batch();
  assert.equal(store.importBatch(input).added, 1);
  assert.equal(store.importBatch(input).added, 0);
  assert.deepEqual(createTrackerStore({ dataDir }).read().characters[0].snapshots[0].stats, input.snapshots[0].stats);
  input.snapshots[0].stats.strength++;
  assert.throws(() => store.importBatch(input), /Conflit/);
  assert.equal(formatStat(undefined), "—");
  assert.equal(formatStat(0, "%"), "0 %");
});

test("stats validation rejects invalid readings and keeps legacy exports readable", () => {
  for (const key of statKeys) {
    for (const value of ["12", Infinity, NaN, {}, 1e10]) {
      const input = batch();
      input.snapshots[0].stats = { [key]: value };
      assert.throws(() => validateImport(input));
    }
  }
  const legacy = batch();
  delete legacy.snapshots[0].stats;
  assert.equal(validateImport(legacy).snapshots[0].stats, undefined);
  const input = batch();
  input.snapshots[0].stats.untrusted = "ignored";
  assert.equal(validateImport(input).snapshots[0].stats.untrusted, undefined);
});

test("local transport serves the stats module and accepts only the supported avatar mode", async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "chaos-avatar-"));
  const server = createLocalServer({ dataDir });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + "/character-stats.js")).status, 200);
  assert.equal((await fetch(base + "/avatar-cache.js")).status, 200);
  const portrait = await fetch(base + "/api/wow-forever-pvp/armory?r=3&a=0&portrait=1");
  assert.equal(portrait.status, 200);
  assert.match(await portrait.text(), /#controls, #credit/);
  assert.equal((await fetch(base + "/api/wow-forever-pvp/armory?r=3&a=0&portrait=invalid")).status, 400);
  const embedded = await fetch(base + "/api/wow-forever-pvp/armory?r=3&a=0&m=hd&controls=0");
  assert.equal(embedded.status, 200);
  const html = await embedded.text();
  assert.match(html, /#controls \{ display: none \}/);
  assert.equal((html.match(/<script type="module"/g) ?? []).length, 1);
  assert.match(html, /<\/div>\s*<button id="retry"/);
  assert.equal((await fetch(base + "/api/wow-forever-pvp/armory?r=3&a=0&controls=invalid")).status, 400);
});
