import { test } from "node:test";
import assert from "node:assert/strict";
import { equipmentSetLines } from "../client/item-sets.js";
import { validateImport } from "../server/import-schema.js";

test("sets preserve equipped pieces and threshold bonuses from the exported loadout", () => {
  const lines = [
    { text: "+8 Intelligence" }, { text: "Tenue du mage (2/3)" },
    { text: "Couronne", effect: true }, { text: " Robe " }, { text: "Bottes" },
    { text: "(2) Set: Augmente les dégâts.", effect: true },
    { text: "(3) Ensemble : Régénère du mana." }, { text: "Durabilité 45 / 60" },
  ];
  const result = equipmentSetLines(lines, [{ link: "|Hitem:2|h[Robe]|h" }]);
  assert.deepEqual(result[1].set, { kind: "header", name: "Tenue du mage", count: 2, total: 3 });
  assert.equal(result[2].set.equipped, true);
  assert.equal(result[3].set.equipped, true);
  assert.equal(result[4].set.equipped, false);
  assert.equal(result[5].set.active, true);
  assert.equal(result[6].set.active, false);
  assert.equal(result[7].set, undefined);
  assert.equal(lines[1].set, undefined, "stored tooltip data must remain unchanged");
});

test("base catalog sets count current equipment instead of catalog highlights", () => {
  const result = equipmentSetLines([
    { text: "Mage (0/2)" }, { text: "Crown", effect: true }, { text: "Robe" },
    { text: "(1) Set: First" }, { text: "(2) Set: Second", effect: true },
  ], [{ name: " crown " }], { base: true });
  assert.equal(result[0].set.count, 1);
  assert.equal(result[1].set.equipped, true);
  assert.equal(result[2].set.equipped, false);
  assert.equal(result[3].set.active, true);
  assert.equal(result[4].set.active, false);
  assert.deepEqual(equipmentSetLines([{ text: "Charges (1/2)" }]), [{ text: "Charges (1/2)" }]);
});

test("imports preserve long equipment tooltips including all set bonuses", () => {
  const tooltip = Array.from({ length: 40 }, (_, i) => ({ text: `Stat ${i}` }));
  tooltip.push({ text: "(8) Set: Bonus final", effect: true });
  const batch = { format: "chaos-world-pvp", version: 1, sourceId: "set-test", addonVersion: "0.5.25", build: "test", exportedAt: 100,
    character: { name: "Mage", region: "3", realm: "Realm", ruleset: "pvp" },
    snapshots: [{ id: "a", at: 100, equipment: [{ slot: 1, itemId: 1, tooltip }] }], events: [] };
  assert.deepEqual(validateImport(batch).snapshots[0].equipment[0].tooltip, tooltip);
});
