import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveStateTransmogs } from "../server/transmog.js";
import { armoryParams, avatarParams } from "../client/armory.js";

test("Forever tooltip appearances repair the model and portrait without rewriting source observations", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(url);
    return Response.json(url.endsWith("ro.json") ? [["Robe of Evocation", "item", 14150]]
      : [["Crystalline Cuffs", "item", 14148], ["Crystalline Cuffs", "spell", 1]]);
  };
  const item = (slot, id, name) => ({ slot, itemId: id, transmogItemId: id,
    tooltip: [{ text: "Transmogrified to:" }, { text: name }] });
  const equipment = [item(1, 7048, "Hidden Helm"), item(5, 4324, "Robe of Evocation"),
    item(9, 15864, "Crystalline Cuffs"), { slot: 16, itemId: 271215, enchantId: 1897 },
    { ...item(3, 7684, "Another appearance"), transmogItemId: 456 }];
  const state = { characters: [{ raceId: 5, sex: 3, snapshots: [{ equipment }, { equipment }] }] };
  const result = await resolveStateTransmogs(state);
  const character = result.characters[0];
  const snapshot = character.snapshots[0];
  assert.deepEqual(snapshot.equipment.map((i) => i.transmogItemId), [0, 14150, 14148, undefined, 456]);
  const gear = armoryParams(5, 3, snapshot.equipment).get("g");
  assert.match(gear, /e14150/u);
  assert.match(gear, /h14148/u);
  assert.match(gear, /q271215e1897/u);
  assert.ok(!gear.includes("a7048"));
  assert.equal(avatarParams(character, snapshot).has("g"), false);
  assert.equal(equipment[0].transmogItemId, 7048);
  assert.equal(snapshot.equipment[1].itemId, 4324);
  assert.equal(requests.length, 2, "Only distinct name shards, never one request per observation");
});

test("unavailable, ambiguous and partial name matches never invent an appearance", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url) => {
    if (url.endsWith("fa.json")) throw new Error("offline");
    return Response.json([["Ambiguous Robe", "item", 1], ["Ambiguous Robe", "item", 2],
      ["Partial Name Extended", "item", 3]]);
  };
  const equipment = ["Fail Robe", "Ambiguous Robe", "Partial Name"].map((name, index) => ({
    slot: index + 5, itemId: 100 + index,
    tooltip: [{ text: "Transmogrified to:" }, { text: name }],
  }));
  const result = await resolveStateTransmogs({ characters: [{ snapshots: [{ equipment }] }] });
  for (const item of result.characters[0].snapshots[0].equipment) {
    assert.equal(item.transmogItemId, undefined);
    assert.equal(item.transmogUnresolved, true);
  }
});
