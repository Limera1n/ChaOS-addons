import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { createTrackerStore } from "../server/store.js";
import { validateImport } from "../server/import-schema.js";
import { createLocalServer } from "../server/local-server.js";
import { API_PATH, IMPORT_TYPE } from "../server/routes.js";
import { groupZones, honorProgress, itemQuality, summarize } from "../client/model.js";
import { ARMORY_VIEW_PATH, armoryRace, armoryUrl } from "../client/armory.js";

test("armory keeps legacy race names and uses the dressing room slot order", () => {
  assert.equal(armoryRace({ race: "Morte-vivante" }), 5);
  assert.equal(armoryRace({ race: "Skyborne", faction: "Horde" }), 96);
  assert.equal(armoryRace({ raceId: 95 }), 95);
  const url = armoryUrl(95, 3, [
    { slot: 4, itemId: 4 },
    { slot: 15, itemId: 15 },
    { slot: 16, itemId: 16, link: "|Hitem:16:1900:0|h[Épée]|h" },
    { slot: 19, itemId: 19 },
  ]);
  assert.deepEqual(Object.fromEntries(url.searchParams), { r: "95", a: "1", g: "d15.f4.g19.q16e1900" });
});

test("equipment metadata survives import and legacy links still supply quality", () => {
  const input = batch();
  Object.assign(input.character, { raceId: 95, sex: 3 });
  Object.assign(input.snapshots[1].equipment[0], { icon: 133138, quality: 4 });
  const imported = validateImport(input);
  assert.equal(imported.character.raceId, 95);
  assert.equal(imported.character.sex, 3);
  const [item] = imported.snapshots[1].equipment;
  assert.equal(item.icon, 133138);
  assert.equal(itemQuality(item), 4);
  assert.equal(itemQuality({ link: "|cffff8000|Hitem:19019|h[Thunderfury]|h|r" }), 5);
  assert.equal(itemQuality({ link: "|cnIQ3:|Hitem:1|h[Rare item]|h|r" }), 3);
  assert.equal(itemQuality({}), -1);
});

test("honor progress preserves zero and attributes guild gains using the last observed membership", () => {
  const gain = (at, amount, context = "world") => ({ at, amount, context, type: "honor-gain" });
  const one = {
    snapshots: [{ at: 10, guild: "Guild" }, { at: 20, guild: "Other" }],
    events: [gain(9, 4), gain(15, 2), gain(18, 6, "pvp"), gain(21, 8)],
  };
  const two = { snapshots: [{ at: 12, guild: "Guild" }], events: [gain(15, 3), gain(25, 1)] };
  assert.equal(honorProgress([one]).total, 14);
  assert.deepEqual(honorProgress([one, two], "Guild"), {
    start: 10, end: 25, total: 6,
    points: [{ at: 15, total: 5 }, { at: 25, total: 6 }],
  });
  assert.deepEqual(honorProgress([{ snapshots: [{ at: 10 }], events: [] }]), {
    start: 10, end: 10, total: 0, points: [],
  });
  assert.equal(honorProgress([{ snapshots: [], events: [] }]), null);
});

function batch() {
  return {
    format: "chaos-world-pvp",
    version: 1,
    sourceId: "installation-a",
    addonVersion: "0.1.0",
    build: "test-only",
    exportedAt: 200,
    character: {
      name: "Test <script>",
      realm: "Test Realm",
      region: "3",
      ruleset: "unknown",
      level: 60,
    },
    snapshots: [
      { id: "1", at: 100, lifetimeHK: 10, guild: "Test guild", equipment: [] },
      {
        id: "2",
        at: 200,
        lifetimeHK: 13,
        equipment: [{ slot: 1, itemId: 123 }],
      },
    ],
    events: [
      {
        id: "3",
        at: 120,
        type: "honor-gain",
        amount: 2,
        context: "world",
        location: { mapId: 37, zone: "Test zone", x: 0.2, y: 0.3, at: 120 },
      },
      { id: "4", at: 130, type: "death", amount: 0, context: "world" },
      { id: "5", at: 140, type: "honor-gain", amount: 1, context: "pvp" },
    ],
  };
}
function temporary(t) {
  const path = mkdtempSync(join(tmpdir(), "chaos-pvp-test-"));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

test("imports survive restart, deduplicate and reject changed events atomically", (t) => {
  const dataDir = temporary(t);
  let store = createTrackerStore({ dataDir, now: () => 300000 });
  assert.equal(store.importBatch(batch()).added, 5);
  store.stop();
  assert.throws(() => store.read(), /stopped/);
  store = createTrackerStore({ dataDir });
  assert.equal(store.importBatch(batch()).added, 0);
  const upgraded = batch();
  upgraded.addonVersion = "0.2.0";
  upgraded.build = "next-build";
  assert.equal(store.importBatch(upgraded).added, 0);
  const conflicting = batch();
  conflicting.events[0].amount = 99;
  assert.throws(() => store.importBatch(conflicting), /Conflit/);
  assert.equal(store.read().characters[0].events[0].amount, 2);
  assert.equal(
    createTrackerStore({ dataDir }).read().characters[0].events[0].amount,
    2,
  );
});

test("late imports preserve metadata and sort observations by collection time", (t) => {
  const store = createTrackerStore({ dataDir: temporary(t) });
  store.importBatch(batch());
  const old = batch();
  old.character.level = 10;
  old.snapshots = [old.snapshots[0]];
  old.events = [];
  old.exportedAt = 150;
  store.importBatch(old);
  assert.equal(store.read().characters[0].level, 60);
  assert.equal(store.read().characters[0].snapshots.at(-1).at, 200);
});

test("world counters exclude BGs and do not infer deaths as PvP or fill unknown zones", (t) => {
  const store = createTrackerStore({ dataDir: temporary(t) });
  store.importBatch(batch());
  const character = store.read().characters[0];
  const summary = summarize(character);
  assert.equal(summary.worldHK, 2);
  assert.equal(summary.delta, 3);
  assert.equal(summary.deaths, 1);
  assert.equal(character.events[1].cause, "unknown");
  assert.equal(
    groupZones(summary.events).find((zone) => zone.key === "unknown").deaths,
    1,
  );
  character.events.push({ at: 150, type: "counter-reset" });
  assert.equal(summarize(character).delta, null);
});

test("schema rejects malformed coordinates, duplicate identities, future and oversized observations", () => {
  for (const mutate of [
    (value) => {
      value.version = 2;
    },
    (value) => {
      value.events[0].location.x = 1.1;
    },
    (value) => {
      value.events[0].location.y = null;
    },
    (value) => {
      value.events[0].location.at = 121;
    },
    (value) => {
      value.events[0].location.at = 1;
    },
    (value) => {
      value.events[0].amount = -1;
    },
    (value) => {
      value.events[0].context = "untrusted";
    },
    (value) => {
      value.events[0].at = 201;
    },
    (value) => {
      value.events[1].id = value.events[0].id;
    },
    (value) => {
      value.events = Array(5001).fill(value.events[0]);
    },
    (value) => {
      value.character.name = "x".repeat(161);
    },
  ]) {
    const input = batch();
    mutate(input);
    assert.throws(() => validateImport(input), /Export invalide/);
  }
  const input = batch();
  input.events[1].cause = "pvp";
  input.character.extra = "<script>";
  const clean = validateImport(input);
  assert.equal(clean.events[1].cause, "unknown");
  assert.equal(clean.character.extra, undefined);
});

test("local HTTP transport rejects foreign hosts/origins and oversized requests", async (t) => {
  const server = createLocalServer({ dataDir: temporary(t) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(url)).status, 200);
  const armory = await fetch(url + ARMORY_VIEW_PATH + "?r=95&a=1&g=a12640.q19019");
  assert.equal(armory.status, 200);
  assert.match(armory.headers.get("content-security-policy"), /frame-src https:\/\/mattjcr\.github\.io\/wowforeverultimatecalculator\/embed\//u);
  assert.match(await armory.text(), /sandbox="allow-scripts allow-same-origin".*g=a12640\.q19019/u);
  assert.equal((await fetch(url + ARMORY_VIEW_PATH + "?r=95&a=1&g=%22%3E")).status, 400);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    const call = request(
      url + API_PATH + "/state",
      { headers: { Host: "attacker.example" } },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    call.on("error", reject);
    call.end();
  });
  assert.equal(foreignHostStatus, 403);
  const post = (body, origin = url) =>
    fetch(url + API_PATH + "/import", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": IMPORT_TYPE },
      body,
    });
  assert.equal(
    (await post(JSON.stringify(batch()), "https://attacker.example")).status,
    403,
  );
  assert.equal((await post("{")).status, 400);
  assert.equal((await post("x".repeat(2 * 1024 * 1024 + 1))).status, 413);
  assert.equal((await post(JSON.stringify(batch()))).status, 200);
  const state = await (await fetch(url + API_PATH + "/state")).json();
  assert.equal(state.characters.length, 1);
});
