import { test } from "node:test";
import assert from "node:assert/strict";

class Element {
  constructor(dataset = {}, text = "") {
    this.dataset = dataset; this._text = text; this.children = [];
    this.handlers = {}; this.attributes = {}; this.style = {}; this.hidden = true;
  }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this._text = value ?? ""; this.children = []; }
  addEventListener(name, handler) { this.handlers[name] = handler; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name]; }
  removeAttribute(name) { delete this.attributes[name]; }
  replaceChildren() { this.children = []; this._text = ""; }
  append(child) { this.children.push(child); }
  matches() { return false; }
  contains(node) { return node === this; }
  getBoundingClientRect() { return { left: 950, right: 990, top: 750, bottom: 790 }; }
}

test("shared tooltips show recipe effects, talent ranks and enchants on hover, focus and touch", async (t) => {
  const tooltip = new Element(); tooltip.id = "equipment-tooltip";
  tooltip.offsetWidth = 300; tooltip.offsetHeight = 120;
  const documentHandlers = {}, windowHandlers = {};
  const previousDocument = globalThis.document, previousWindow = globalThis.window;
  globalThis.document = { querySelector: () => tooltip, createElement: () => new Element(),
    documentElement: { clientWidth: 1000, clientHeight: 800 },
    addEventListener: (name, fn) => documentHandlers[name] = fn };
  globalThis.window = { addEventListener: (name, fn) => windowHandlers[name] = fn };
  t.after(() => { globalThis.document = previousDocument; globalThis.window = previousWindow; });
  const { bindProfileTooltips, bindEquipmentTooltips } = await import("../client/item-tooltips.js");
  const recipe = new Element({ professionId: "197", recipeId: "1" });
  const enchantRecipe = new Element({ professionId: "333", recipeId: "1" });
  const talent = new Element({ treeId: "1", nodeId: "10" });
  const enchant = new Element({}, "+5 dégâts de l’arme");
  const profile = { querySelectorAll: (selector) => ({
    "[data-recipe-id]": [recipe, enchantRecipe], ".talent-node": [talent], ".item-enchant": [enchant],
  })[selector] ?? [] };
  bindProfileTooltips(profile, { items: [
    { skillLineId: 197, name: "Couture", recipes: [{ id: 1, name: "Bottes", tooltip: [{ text: "+7 Endurance", effect: true }, { text: "Reagents: |nCloth" }],
      reagents: [{ options: [{ itemId: 2589, name: "Cloth", quantity: 6, icon: 132911 }] }] }] },
    { skillLineId: 333, name: "Enchantement", recipes: [{ id: 1, name: "Endurance", description: "Augmente l’endurance de 3.",
      reagents: [{ options: [{ itemId: 10940, name: "Strange Dust", quantity: 2 }] },
        { optional: true, options: [{ itemId: 1, name: "A", quantity: 4 }, { currencyId: 55, name: "B", quantity: 3 }] }] }] },
  ] }, { trees: [{ id: 1, nodes: [{ id: 10, rank: 2, maxRank: 5, spent: 1, entries: [{ id: 1, name: "Givre", description: "Dégâts +6 %." }] }] }] });
  bindEquipmentTooltips(profile, []);
  const lines = () => tooltip.children.map((child) => child.textContent).join(" | ");
  recipe.handlers.pointerenter({ pointerType: "mouse" });
  assert.equal(tooltip.hidden, false);
  assert.match(lines(), /Bottes.*Couture.*\+7 Endurance/);
  assert.match(lines(), /pour 1 fabrication.*Cloth × 6/);
  assert.ok(!lines().includes("Reagents:"));
  assert.ok(!lines().includes("|n"));
  const componentLine = tooltip.children.find((child) => child.className === "tooltip-reagent");
  const component = componentLine.children[0];
  assert.equal(component.children[0].className, "tooltip-reagent-icon");
  assert.equal(component.children[0].attributes["aria-hidden"], "true");
  const componentIcon = component.children[0].children[0];
  assert.equal(componentIcon.src, "https://zephras.com/icons/card/132911.jpg");
  assert.equal(componentIcon.width, 18);
  assert.equal(component.children[1].textContent, "Cloth × 6");
  assert.equal(recipe.attributes["aria-describedby"], tooltip.id);
  assert.equal(tooltip.style.left, "640px", "tooltip stays inside the right edge");
  assert.equal(tooltip.style.top, "670px", "tooltip stays above the bottom edge");
  recipe.handlers.pointerleave();
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.equal(tooltip.hidden, true);
  assert.equal(recipe.attributes["aria-describedby"], undefined);
  talent.handlers.focus();
  assert.match(lines(), /Givre.*2\/5.*1 point investi.*Dégâts \+6 %/);
  documentHandlers.keydown({ key: "Escape" });
  assert.equal(tooltip.hidden, true);
  enchantRecipe.handlers.pointerenter({ pointerType: "touch" });
  assert.equal(tooltip.hidden, true);
  let stopped = false;
  enchantRecipe.handlers.click({ pointerType: "touch", stopPropagation: () => stopped = true });
  assert.equal(stopped, true, "nested enchant touch must not activate the equipment tooltip");
  assert.match(lines(), /Endurance.*Enchantement.*Augmente l’endurance/);
  assert.match(lines(), /Strange Dust × 2.*A × 4 ou B × 3 \(facultatif\)/);
  const withoutIcon = tooltip.children.find((child) => child.className === "tooltip-reagent");
  assert.equal(withoutIcon.children[0].children[0].children.length, 0, "legacy reagents retain alignment without broken images");
  enchantRecipe.handlers.pointerleave();
  assert.equal(tooltip.hidden, false, "touch tooltip stays pinned");
  documentHandlers.pointerdown({ target: new Element() });
  assert.equal(tooltip.hidden, true);
  enchant.handlers.focus();
  assert.match(lines(), /Enchantement.*\+5 dégâts/);
  enchant.handlers.blur();
  assert.equal(tooltip.hidden, true);
  assert.equal(typeof windowHandlers.resize, "function");

  const legacy = new Element({ professionId: "197", recipeId: "2" });
  const free = new Element({ professionId: "197", recipeId: "3" });
  bindProfileTooltips({ querySelectorAll: (selector) => selector === "[data-recipe-id]" ? [legacy, free] : [] },
    { items: [{ skillLineId: 197, name: "Couture", recipes: [
      { id: 2, name: "Ancienne recette", tooltip: [{ text: "Reagents: |nCloth" }, { text: "Première ligne|nDeuxième ligne" }] },
      { id: 3, name: "Recette gratuite", description: "Sans coût", reagents: [] },
    ] }] });
  legacy.handlers.focus();
  assert.match(lines(), /Quantités des composants non relevées/);
  assert.ok(!lines().includes("Reagents:"));
  assert.match(lines(), /Première ligne\nDeuxième ligne/);
  free.handlers.focus();
  assert.match(lines(), /Aucun composant requis/);
  assert.ok(!lines().includes("non relevées"));

  const gear = new Element({ slot: "1", quality: "4" });
  bindEquipmentTooltips({ querySelectorAll: (selector) => selector === ".item[data-quality]" ? [gear] : [] }, [
    { slot: 1, name: "Couronne", link: "|Hitem:1|h[Couronne]|h", tooltip: [
      { text: "Tenue du mage (1/2)" }, { text: "Couronne", effect: true }, { text: "Robe" },
      { text: "(1) Set: +10 Intelligence", effect: true }, { text: "(2) Set: +20 Intelligence" },
    ] },
  ]);
  gear.handlers.focus();
  assert.match(lines(), /Tenue du mage · 1\/2 équipées.*✓ CouronneÉquipé.*○ RobeNon équipé/);
  assert.match(lines(), /✓ Actif · 1 pièce : \+10 Intelligence.*○ Inactif · 2 pièces : \+20 Intelligence/);
  assert.equal(tooltip.children[1].className, "tooltip-line tooltip-set-header");
  assert.equal(tooltip.children[4].className, "tooltip-line tooltip-set-bonus tooltip-set-active");
  gear.handlers.pointerleave();
  tooltip.handlers.pointerenter();
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.equal(tooltip.hidden, false, "long set tooltips remain available for scrolling");
  tooltip.handlers.pointerleave();
  assert.equal(tooltip.hidden, true);
});
