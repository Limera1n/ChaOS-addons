import { test } from "node:test";
import assert from "node:assert/strict";
import { worldRect, zoomView, constrainView, regionAt, easeView } from "../client/map-view.js";
import { AZEROTH, projectPosition } from "../client/map-regions.js";

test("zone art and event positions use the same world coordinates", () => {
  for (const mapId of ["1420", "1429", "1454", "1446"]) {
    const rect = worldRect(mapId);
    const point = projectPosition({ mapId, x: .295, y: .652 }, AZEROTH);
    assert.ok(Math.abs((rect.x + .295 * rect.width) / 150 - point.x) < 1e-12);
    assert.ok(Math.abs((rect.y + .652 * rect.height) / 100 - point.y) < 1e-12);
  }
  assert.equal(worldRect("2521"), null);
  assert.equal(worldRect("unknown"), null);
});

test("zoom keeps the world position under the cursor fixed", () => {
  const before = { x: 50, y: 20, width: 60, height: 40 };
  const after = zoomView(before, .6, .2, .8);
  assert.equal(before.x + before.width * .2, after.x + after.width * .2);
  assert.equal(before.y + before.height * .8, after.y + after.height * .8);
  assert.equal(after.width / after.height, 1.5);
});

test("pan and zoom stop at the world edges and detail limit", () => {
  assert.deepEqual(zoomView(worldRect(AZEROTH), 2), worldRect(AZEROTH));
  assert.deepEqual(constrainView({ x: -20, y: 90, width: 30, height: 20 }),
    { x: 0, y: 80, width: 30, height: 20 });
  assert.equal(zoomView(worldRect(AZEROTH), 1e-9).width, 150 / 24);
});

test("hover identifies zones in world coordinates, including neighboring continents", () => {
  for (const [mapId, x, y] of [["1420", .295, .652], ["1429", .5, .5], ["1411", .5, .5], ["1446", .5, .5]]) {
    const rect = worldRect(mapId);
    assert.equal(regionAt(rect.x+x*rect.width, rect.y+y*rect.height), mapId);
  }
  assert.equal(regionAt(75, 50), null, "open sea is not an arbitrary rectangular zone");
});

test("smooth zoom converges without overshoot and preserves the cursor anchor throughout", () => {
  let view = { x: 50, y: 20, width: 60, height: 40 };
  const target = zoomView(view, .5, .2, .8);
  const anchor = { x: view.x+view.width*.2, y: view.y+view.height*.8 };
  for (let i = 0; i < 120; i++) {
    const next = easeView(view, target, 16);
    assert.ok(next.width <= view.width && next.width >= target.width);
    assert.ok(Math.abs(next.x+next.width*.2-anchor.x) < 1e-10);
    assert.ok(Math.abs(next.y+next.height*.8-anchor.y) < 1e-10);
    view = next;
  }
  assert.deepEqual(view, target);
});
