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
import { filterDeaths, groupZones, honorProgress, itemQuality, summarize } from "../client/model.js";
import { ARMORY_VIEW_PATH, armoryParams, armoryRace } from "../client/armory.js";
import { installEnchantModels, selectAppearance } from "../client/armory-viewer.js";
import { ARMORY_ASSET_PATH, serveArmoryAsset, serveArmoryMetadata } from "../server/armory.js";
import { AZEROTH, mapContains, projectPosition } from "../client/map-regions.js";

test("death filters preserve honor gains and keep unknown causes separate", () => {
  const events = [
    { type: "honor-gain", amount: 3 },
    ...["pvp", "pve", "environment", "self", "unknown", undefined].map((cause) => ({ type: "death", cause })),
  ];
  assert.deepEqual(filterDeaths(events), events);
  for (const cause of ["pvp", "pve", "environment", "self"])
    assert.deepEqual(filterDeaths(events, cause), [events[0], events.find((item) => item.cause === cause)]);
  assert.deepEqual(filterDeaths(events, "unknown"), [events[0], events[5], events[6]]);
  assert.equal(events.length, 7);
});

test("Tirisfal positions project through the Eastern Kingdoms to Azeroth", () => {
  const location = { mapId: 1420, x: 0.295, y: 0.652 };
  assert.deepEqual(projectPosition(location, "1420"), { x: 0.295, y: 0.652 });
  assert.equal(mapContains("1415", "1420"), true);
  const world = projectPosition(location, AZEROTH);
  assert.ok(Math.abs(world.x - 0.691469) < 0.000001);
  assert.ok(Math.abs(world.y - 0.269225) < 0.000001);
  assert.equal(mapContains("1414", "1420"), false);
  assert.equal(projectPosition(location, "1414"), null);
  assert.equal(projectPosition({ ...location, mapId: 2521 }, AZEROTH), null);
});

test("armory keeps legacy race names and uses the dressing room slot order", () => {
  assert.equal(armoryRace({ race: "Morte-vivante" }), 5);
  assert.equal(armoryRace({ race: "Skyborne", faction: "Horde" }), 96);
  assert.equal(armoryRace({ raceId: 95 }), 95);
  const params = armoryParams(95, 3, [
    { slot: 4, itemId: 4 },
    { slot: 15, itemId: 15 },
    { slot: 16, itemId: 16, link: "|Hitem:16:1900:0|h[Épée]|h" },
    { slot: 19, itemId: 19 },
  ]);
  assert.deepEqual(Object.fromEntries(params), { r: "95", a: "1", g: "d15.f4.g19.q16e1900" });
  assert.equal(armoryParams(8, 2, []).get("a"), "0");
  const appearance = { raceId: 8, sex: 2, choices: [{ optionId: 31, choiceId: 130 }] };
  assert.equal(armoryParams(8, 2, [], appearance).get("a"), "0.31-130");
  assert.equal(armoryParams(8, 3, [], appearance).get("a"), "1");
});

test("barber choices translate between HD and SD, including captures made in SD", () => {
  const hd = { options: [{ id: 11, choices: [{ id: 50 }] }] };
  const sd = { options: [{ id: 9404, choices: [{ id: 77663 }] }] };
  const mapping = [{ SourceOptionId: 11, VariantOptionId: 9404, Choices: [{ SourceChoiceId: 50, VariantChoiceId: 77663 }] }];
  const capturedHd = [{ optionId: 11, choiceId: 50 }];
  const capturedSd = [{ optionId: 9404, choiceId: 77663 }];
  assert.deepEqual(selectAppearance(capturedHd, hd, mapping), { options: capturedHd, unmatched: 0 });
  assert.deepEqual(selectAppearance(capturedHd, sd, mapping), { options: capturedSd, unmatched: 0 });
  assert.deepEqual(selectAppearance(capturedSd, hd, mapping), { options: capturedHd, unmatched: 0 });
  assert.deepEqual(selectAppearance(capturedSd, sd, mapping), { options: capturedSd, unmatched: 0 });
  assert.deepEqual(selectAppearance([{ optionId: 999, choiceId: 1 }], sd, mapping), { options: [], unmatched: 1 });
});

test("missing enchant models use the common pack with its textures and particles, preserving Forever gear", async () => {
  const calls = [];
  const context = {};
  const options = { allGeosets: true };
  const engine = {
    pack(base) {
      assert.equal(base, "forever/");
      return { M: async (id) => id === 166011 ? { m: "existing-fiery" } : undefined };
    },
    async openModel(...args) { assert.equal(this, engine); calls.push(args); return "model"; },
  };
  installEnchantModels(engine, { 103: [166032, 166032, 0], 25: [166011] }, "forever/", "common/");
  assert.equal(await engine.openModel(context, "forever/", 166032, options), "model");
  await engine.openModel(context, "forever/", 166011, options);
  await engine.openModel(context, "forever/", 123, options);
  await engine.openModel(context, "common/", 166032, options);
  assert.deepEqual(calls, [
    [context, "common/", 166032, options],
    [context, "forever/", 166011, options],
    [context, "forever/", 123, options],
    [context, "common/", 166032, options],
  ]);
});

test("armory uses transmog visuals, hides invisible slots and keeps weapon enchants", (t) => {
  const input = batch();
  input.snapshots[1].equipment = [
    { slot: 1, itemId: 123, transmogItemId: 0 },
    { slot: 16, itemId: 456, transmogItemId: 789, link: "|Hitem:456:1900:0|h[Sword]|h" },
    { slot: 17, itemId: 321 },
  ];
  const imported = validateImport(input);
  assert.equal(armoryParams(1, 2, imported.snapshots[1].equipment).get("g"), "q789e1900.r321");
  assert.equal(imported.snapshots[1].equipment[1].itemId, 456);
  const store = createTrackerStore({ dataDir: temporary(t) });
  store.importBatch(input);
  assert.equal(store.read().characters[0].snapshots[1].equipment[0].transmogItemId, 0);
  for (const invalid of [-1, 1.5, "789", 1000000001]) {
    input.snapshots[1].equipment[1].transmogItemId = invalid;
    assert.throws(() => validateImport(input), /Export invalide/);
  }
});

test("viewer resource relays restrict sources, share requests and recover from failures", async (t) => {
  let calls = 0;
  const fetched = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    fetched.push(url);
    calls++;
    if (calls === 1) return new Response(null, { status: 503 });
    if (String(url).includes("charactercustomization")) return Response.json({ AltVariant: { Options: [] } });
    return new Response("texture", { headers: { "Content-Type": "image/avif" } });
  });
  const call = async (handler, url) => {
    const reply = {
      status: null,
      headers: {},
      writeHead(status, headers = {}) {
        this.status = status;
        this.headers = headers;
        return this;
      },
      end(body) { this.body = body; },
    };
    await handler({ url }, reply);
    return reply;
  };
  assert.equal((await call(serveArmoryAsset, ARMORY_ASSET_PATH + "attacker/own/t/test.avif")).status, 400);
  assert.equal((await call(serveArmoryMetadata, "/?model=999")).status, 400);
  assert.equal(calls, 0);
  assert.equal((await call(serveArmoryMetadata, "/?model=1")).status, 502);
  assert.equal((await call(serveArmoryMetadata, "/?model=1")).status, 200);
  const path = ARMORY_ASSET_PATH + "wowbocho-ownf/own/t/test.avif";
  const replies = await Promise.all([call(serveArmoryAsset, path), call(serveArmoryAsset, path)]);
  assert.ok(replies.every((reply) => reply.status === 200 && reply.body.toString() === "texture"));
  assert.equal((await call(serveArmoryAsset, path)).headers["Content-Type"], "image/avif");
  assert.equal(calls, 3);
  assert.equal(fetched.at(-1), "https://wowbocho-ownf.pages.dev/own/t/test.avif");
  assert.equal((await call(serveArmoryAsset, ARMORY_ASSET_PATH + "wowbocho-own35/own/m/glow.wbm")).status, 200);
  assert.equal(fetched.at(-1), "https://wowbocho-own35.pages.dev/own/m/glow.wbm");
  for (const host of ["wowbocho-own0", "wowbocho-own39", "wowbocho-own35.attacker", "attacker"])
    assert.equal((await call(serveArmoryAsset, ARMORY_ASSET_PATH + host + "/own/m/glow.wbm")).status, 400);
});

test("equipment metadata survives import and legacy links still supply quality", () => {
  const input = batch();
  Object.assign(input.character, { raceId: 95, sex: 3 });
  Object.assign(input.snapshots[1].equipment[0], { icon: 133138, quality: 4 });
  input.snapshots[1].equipment[0].tooltip = [{ text: "+2 Agilité", effect: true }];
  const imported = validateImport(input);
  assert.equal(imported.character.raceId, 95);
  assert.equal(imported.character.sex, 3);
  const [item] = imported.snapshots[1].equipment;
  assert.equal(item.icon, 133138);
  assert.deepEqual(item.tooltip, [{ text: "+2 Agilité", effect: true }]);
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
  const observed = batch();
  observed.events[1].cause = "pve";
  observed.events[1].source = "Fatal creature";
  let store = createTrackerStore({ dataDir, now: () => 300000 });
  assert.equal(store.importBatch(observed).added, 5);
  store.stop();
  assert.throws(() => store.read(), /stopped/);
  store = createTrackerStore({ dataDir });
  assert.equal(store.read().characters[0].events[1].source, "Fatal creature");
  assert.equal(store.importBatch(observed).added, 0);
  const upgraded = structuredClone(observed);
  upgraded.addonVersion = "0.2.0";
  upgraded.build = "next-build";
  assert.equal(store.importBatch(upgraded).added, 0);
  const conflicting = structuredClone(observed);
  conflicting.events[0].amount = 99;
  assert.throws(() => store.importBatch(conflicting), /Conflit/);
  assert.equal(store.read().characters[0].events[0].amount, 2);
  assert.equal(
    createTrackerStore({ dataDir }).read().characters[0].events[0].amount,
    2,
  );
});

test("reimports fill missing equipment metadata without rewriting observations", (t) => {
  const dataDir = temporary(t);
  const store = createTrackerStore({ dataDir });
  const legacy = batch();
  store.importBatch(legacy);
  const enriched = batch();
  const item = enriched.snapshots[1].equipment[0];
  Object.assign(item, { icon: 133138, quality: 0, transmogItemId: 0, tooltip: [{ text: "+2 Agilité" }] });

  enriched.events[0].amount = 99;
  assert.throws(() => store.importBatch(enriched), /Conflit/);
  assert.deepEqual(store.read().characters[0].snapshots[1].equipment[0], {
    ...legacy.snapshots[1].equipment[0],
    link: null,
  });
  enriched.events[0].amount = legacy.events[0].amount;

  assert.equal(store.importBatch(enriched).added, 0);
  assert.equal(store.importBatch(legacy).added, 0);
  assert.equal(store.importBatch(enriched).added, 0);
  assert.deepEqual(createTrackerStore({ dataDir }).read().characters[0].snapshots[1].equipment[0], {
    ...item,
    link: null,
  });
  item.itemId++;
  assert.throws(() => store.importBatch(enriched), /Conflit/);
  item.itemId--;
  item.icon++;
  assert.throws(() => store.importBatch(enriched), /Conflit/);
});

test("imports retain the most recent compatible appearance without requiring a new capture", (t) => {
  const store = createTrackerStore({ dataDir: temporary(t) });
  const current = batch();
  Object.assign(current.character, { raceId: 5, sex: 3 });
  const appearance = { raceId: 5, sex: 3, at: 150, choices: [{ optionId: 31, choiceId: 130 }] };
  current.character.appearance = appearance;
  store.importBatch(current);
  const legacy = batch();
  Object.assign(legacy.character, { raceId: 5, sex: 3 });
  store.importBatch(legacy);
  const newer = structuredClone(current);
  newer.character.appearance.at = 190;
  newer.character.appearance.choices[0].choiceId = 131;
  store.importBatch(newer);
  store.importBatch(current);
  assert.deepEqual(store.read().characters[0].appearance, newer.character.appearance);
  current.character.appearance.choices.push({ optionId: 31, choiceId: 132 });
  assert.throws(() => validateImport(current), /Export invalide/);
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
      value.events[1].cause = "untrusted";
    },
    (value) => {
      value.events[1].cause = "pve";
      value.events[1].source = "x".repeat(161);
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
  input.events[1].source = "Adversaire-Royaume";
  input.events[0].cause = "pvp";
  input.events[0].source = "Ignoré";
  input.character.extra = "<script>";
  const clean = validateImport(input);
  assert.equal(clean.events[0].cause, "unknown");
  assert.equal(clean.events[0].source, undefined);
  assert.equal(clean.events[1].cause, "pvp");
  assert.equal(clean.events[1].source, "Adversaire-Royaume");
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
  for (const scene of ["human", "orc", "dwarf", "nightelf", "scourge", "tauren", "skyborne"]) {
    const backdrop = await fetch(`${url}/scenes/${scene}.webp`);
    assert.equal(backdrop.status, 200);
    assert.equal(backdrop.headers.get("content-type"), "image/webp");
    const bytes = Buffer.from(await backdrop.arrayBuffer());
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
    assert.equal(bytes.toString("ascii", 8, 12), "WEBP");
  }
  const armory = await fetch(url + ARMORY_VIEW_PATH + "?r=95&a=1&g=a12640.q19019");
  assert.equal((await fetch(url + API_PATH + "/item-tooltip?shard=256")).status, 400);
  assert.equal(armory.status, 200);
  assert.match(armory.headers.get("content-security-policy"), /script-src 'self' 'unsafe-eval' https:\/\/wowbocho\.com\/tools\/own-viewer\//u);
  assert.match(await armory.text(), /<script type="module" src="\/api\/wow-forever-pvp\/armory\/viewer\.js"/u);
  assert.equal((await fetch(url + ARMORY_VIEW_PATH + "?r=8&a=0b2")).status, 200);
  const customArmory = await fetch(url + ARMORY_VIEW_PATH + "?r=8&a=0b2.31-130~33-211&g=a12640");
  assert.equal(customArmory.status, 200);
  assert.match(await customArmory.text(), /id="definition"/u);
  const sdArmory = await fetch(url + ARMORY_VIEW_PATH + "?r=8&a=1b2.31-130&g=b500.k700.q19019e2564&m=sd");
  assert.equal(sdArmory.status, 200);
  assert.match(await sdArmory.text(), /<option value="sd">SD<\/option>/u);
  const viewerScript = await fetch(url + ARMORY_VIEW_PATH + "/viewer.js");
  assert.equal(viewerScript.status, 200);
  assert.match(viewerScript.headers.get("content-type"), /text\/javascript/u);
  assert.equal((await fetch(url + ARMORY_VIEW_PATH + "/metadata?model=999")).status, 400);
  assert.equal((await fetch(url + ARMORY_VIEW_PATH + "?r=1&a=0&g=b500&m=sd")).status, 200);
  assert.equal((await fetch(url + ARMORY_VIEW_PATH + "?r=1&a=0&m=other")).status, 400);
  assert.equal((await fetch(url + ARMORY_VIEW_PATH + "?r=8&a=0b2.31-0")).status, 400);
  assert.equal((await fetch(url + ARMORY_VIEW_PATH + "?r=8&a=0b999")).status, 400);
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
