import { test } from "node:test";
import assert from "node:assert/strict";
import { createAvatarCache } from "../client/avatar-cache.js";
import { avatarParams, mountAvatar } from "../client/armory.js";
import { capturePortrait, frameHead, viewerEquipment } from "../client/armory-viewer.js";

const png = "data:image/png;base64,aGVsbG8=";
const storage = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
};

test("list, profile and later navigations share one avatar render and persist the PNG across reloads", async () => {
  const saved = storage();
  let renders = 0;
  let finish;
  const cache = createAvatarCache({ storage: saved, generate: () => {
    renders++;
    return new Promise((resolve) => { finish = resolve; });
  } });
  const list = cache.get("appearance");
  const profile = cache.get("appearance");
  assert.equal(list, profile);
  await Promise.resolve();
  finish(png);
  assert.equal(await list, png);
  assert.equal(await cache.get("appearance"), png);
  assert.equal(renders, 1);
  const reloaded = createAvatarCache({ storage: saved, generate: () => assert.fail("Already stored") });
  assert.equal(reloaded.peek("appearance"), png);
  assert.equal(await reloaded.get("appearance"), png);
});

test("different appearances render serially, and a failure does not block subsequent portraits", async () => {
  let active = 0;
  let maximum = 0;
  const cache = createAvatarCache({ generate: async (key) => {
    active++;
    maximum = Math.max(maximum, active);
    await Promise.resolve();
    active--;
    if (key === "failed") throw new Error("Offline");
    return png;
  } });
  const results = await Promise.allSettled([cache.get("failed"), cache.get("a"), cache.get("b")]);
  assert.deepEqual(results.map((result) => result.status), ["rejected", "fulfilled", "fulfilled"]);
  assert.equal(maximum, 1);
  await assert.rejects(cache.get("failed"), /Offline/);
});

test("a portrait captured from the visible model satisfies queued work without a second render", async () => {
  let finish;
  const generated = [];
  const cache = createAvatarCache({ generate: (key) => {
    generated.push(key);
    return new Promise((resolve) => { finish = resolve; });
  } });
  const first = cache.get("first");
  const second = cache.get("visible-character");
  await Promise.resolve();
  cache.remember("visible-character", png);
  finish(png);
  await first;
  assert.equal(await second, png);
  assert.deepEqual(generated, ["first"]);
});

test("avatar capture is square and restores the visible model camera even when PNG encoding fails", () => {
  for (const fail of [false, true]) {
    const center = [1, 0, 2], translation = [0.1, 0.2, 0];
    const renderer = {
      _c: center, _lift: 1, translation, azimuth: 4, zenith: 1.3,
      distance: 5, doUpdateBounds: false, _paused: false, fov: 30,
      width: 700, height: 500, zoom: { current: 2, target: 3 },
      actors: [{ getBounds: () => [[0, 0, 0], [1, 1, 2]], setAnimPaused(value) { renderer._paused = value; } }],
      draw() {}, onResize(width, height) { this.width = width; this.height = height; },
    };
    const canvas = { toDataURL(type) {
      assert.equal(type, "image/png");
      assert.equal(renderer.width, 96);
      assert.equal(renderer.height, 96);
      if (fail) throw new Error("Encoding failed");
      return png;
    } };
    if (fail) assert.throws(() => capturePortrait(renderer, canvas), /Encoding/);
    else assert.equal(capturePortrait(renderer, canvas), png);
    assert.equal(renderer.width, 700);
    assert.equal(renderer.height, 500);
    assert.equal(renderer._c, center);
    assert.equal(renderer.translation, translation);
    assert.equal(renderer.distance, 5);
    assert.equal(renderer._lift, 1);
    assert.equal(renderer.azimuth, 4);
    assert.equal(renderer.zenith, 1.3);
    assert.equal(renderer._paused, false);
    assert.deepEqual(renderer.zoom, { current: 2, target: 3 });
  }
});

test("cache is bounded, tolerates blocked storage, and rejects invalid images", async () => {
  const saved = storage();
  const cache = createAvatarCache({ storage: saved, maxEntries: 2, generate: async () => png });
  for (const key of ["a", "b", "c"]) await cache.get(key);
  assert.equal(cache.peek("a"), undefined);
  const reloaded = createAvatarCache({ storage: saved, generate: async () => png });
  assert.equal(reloaded.peek("a"), undefined);
  assert.equal(reloaded.peek("b"), png);
  const blocked = { getItem() { throw new Error(); }, setItem() { throw new Error(); } };
  assert.equal(await createAvatarCache({ storage: blocked, generate: async () => png }).get("a"), png);
  await assert.rejects(createAvatarCache({ generate: async () => "https://invalid.test/image" }).get("a"), /invalide/);
});

test("head avatar key ignores non-head equipment, enchantments, dates and tooltips", () => {
  const character = { raceId: 3, sex: 2 };
  const helmet = { slot: 1, itemId: 123 };
  const original = avatarParams(character, { equipment: [helmet] }).toString();
  assert.equal(avatarParams(character, { at: 999, equipment: [
    { ...helmet, enchantId: 321, tooltip: [{ text: "Updated tooltip" }] },
    { slot: 16, itemId: 456, enchantId: 1897 }, { slot: 8, itemId: 789 }, { slot: 3, itemId: 999 },
  ] }).toString(), original);
  assert.notEqual(avatarParams(character, { equipment: [{ ...helmet, transmogItemId: 456 }] }).toString(), original);
  assert.notEqual(avatarParams({ ...character, appearance: { raceId: 3, sex: 2, choices: [{ optionId: 1, choiceId: 2 }] } }, { equipment: [helmet] }).toString(), original);
  assert.equal(avatarParams(character, { equipment: [{ ...helmet, transmogItemId: 0 }] }).has("g"), false);
  const choices = [{ optionId: 2, choiceId: 4 }, { optionId: 1, choiceId: 3 }];
  const appearance = { raceId: 3, sex: 2, choices };
  assert.equal(avatarParams({ ...character, appearance }).toString(), avatarParams({ ...character, appearance: { ...appearance, choices: [...choices].reverse() } }).toString());
  assert.equal(choices[0].optionId, 2, "Do not mutate imported appearance");
});

test("portrait renderer only loads the helmet even when given full dressing room equipment", () => {
  const equipment = [{ slot: 1, itemId: 123, enchantId: 999 }, { slot: 3, itemId: 456 }, { slot: 16, itemId: 789, enchantId: 1897 }];
  assert.deepEqual(viewerEquipment(equipment, true), [{ slot: 1, itemId: 123, enchantId: 0 }]);
  assert.equal(viewerEquipment(equipment, false), equipment, "Full character retains all its gear");
  assert.equal(equipment[0].enchantId, 999);
});

test("head framing follows the helmet anchor, stays independent of whole-body camera distance and pauses animation", () => {
  for (const height of [1.2, 2.5, 3.5]) {
    let draws = 0, paused = false;
    const matrix = new Float32Array(16);
    matrix[12] = 0.12;
    matrix[13] = height * 0.88;
    matrix[14] = -0.03;
    const renderer = {
      actors: [{ getBounds: () => [[-0.5, -0.5, 0], [0.5, 0.5, height]],
        _own: { r: { getAttachmentTransform(id) { assert.equal(id, 11); return matrix; } } },
        setAnimPaused(value) { paused = value; },
      }],
      fov: 30, distance: 100, zoom: { current: 1, target: 1 }, draw() { draws++; },
    };
    frameHead(renderer);
    assert.deepEqual(renderer._c, [matrix[12], 0, matrix[14]]);
    assert.equal(renderer._lift, matrix[13]);
    assert.ok(Math.abs(renderer.distance * 2 * Math.tan(Math.PI / 12) - height * 0.20) < 1e-6);
    assert.equal(renderer.zoom.current, 0);
    assert.equal(renderer.zoom.target, 0);
    assert.equal(renderer.doUpdateBounds, false);
    assert.equal(paused, true);
    assert.equal(draws, 2);
  }
});

test("navigation replaces avatar containers without replacing the generator; only its own message is accepted", async (t) => {
  const globals = ["window", "document", "location", "IntersectionObserver"];
  const previous = globals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  t.after(() => globals.forEach((key, i) => {
    if (previous[i]) Object.defineProperty(globalThis, key, previous[i]);
    else delete globalThis[key];
  }));
  const listeners = new Set();
  const frames = [];
  Object.defineProperty(globalThis, "IntersectionObserver", { configurable: true, value: undefined });
  globalThis.location = { origin: "http://localhost" };
  globalThis.window = {
    localStorage: storage(),
    addEventListener: (_type, fn) => listeners.add(fn),
    removeEventListener: (_type, fn) => listeners.delete(fn),
  };
  globalThis.document = {
    createElement: (tag) => ({ tag, contentWindow: {}, setAttribute() {}, remove() { this.removed = true; } }),
    body: { append: (frame) => frames.push(frame) },
  };
  const target = () => ({ isConnected: true, dataset: {}, replaceChildren(image) { this.image = image; } });
  const first = target(), second = target(), afterNavigation = target();
  const character = { name: "Tester", raceId: 3, sex: 2 };
  mountAvatar(first, character);
  mountAvatar(second, character);
  await new Promise(setImmediate);
  assert.equal(frames.length, 1);
  first.isConnected = false;
  mountAvatar(afterNavigation, character);
  for (const receive of listeners) receive({ origin: location.origin, source: {}, data: { type: "chaos-avatar-ready", image: png } });
  assert.equal(frames[0].removed, undefined);
  for (const receive of listeners) receive({ origin: location.origin, source: frames[0].contentWindow, data: { type: "chaos-avatar-ready", image: png } });
  await new Promise(setImmediate);
  assert.equal(first.image, undefined);
  assert.equal(second.image.src, png);
  assert.equal(afterNavigation.image.src, png);
  assert.equal(frames[0].removed, true);
  assert.equal(listeners.size, 0);
  const cached = target();
  mountAvatar(cached, character);
  assert.equal(cached.image.src, png);
  assert.equal(frames.length, 1);
});
