import { itemEnchantLabel } from "./armory.js";

const SHARDS = 256;
const catalog = new Map();
const stats = new Map([
  ["Agility", "Agilité"], ["Strength", "Force"], ["Stamina", "Endurance"],
  ["Intellect", "Intelligence"], ["Spirit", "Esprit"], ["Armor", "Armure"],
]);
const tooltip = document.querySelector("#equipment-tooltip");
let active, pinned;

function translateStat(text) {
  return text.replace(/^([+-]?\d+(?:\.\d+)?) (Agility|Strength|Stamina|Intellect|Spirit|Armor)$/u,
    (_, value, stat) => `${value} ${stats.get(stat)}`);
}

async function itemLines(id) {
  const shard = id % SHARDS;
  if (!catalog.has(shard)) {
    if (catalog.size >= 24) catalog.delete(catalog.keys().next().value);
    const request = fetch(`/api/wow-forever-pvp/item-tooltip?shard=${shard}`)
      .then((response) => {
        if (!response.ok) throw new Error("Tooltip catalog unavailable");
        return response.text();
      })
      .then((html) => {
        // Keep the upstream templates inert. Only their text is rendered.
        const documentFragment = document.createElement("template");
        documentFragment.innerHTML = html;
        return documentFragment.content;
      })
      .catch(() => {
        if (catalog.get(shard) === request) catalog.delete(shard);
        return null;
      });
    catalog.set(shard, request);
  }
  const page = await catalog.get(shard);
  const item = page?.querySelector(`template[data-id="${id}"]`)?.content.querySelector(".tip");
  return [...(item?.children ?? [])].filter((line) => !line.classList.contains("tip-name")).slice(0, 24)
    .map((line) => ({
      text: translateStat((line.classList.contains("tip-pair") ? line.firstElementChild : line)?.textContent.trim() ?? ""),
      right: line.classList.contains("tip-pair") ? line.children[1]?.textContent.trim() : null,
      effect: line.classList.contains("tip-equip"),
    }));
}

function positionTooltip() {
  if (!active || tooltip.hidden) return;
  const bounds = active.getBoundingClientRect();
  const width = document.documentElement.clientWidth;
  const height = document.documentElement.clientHeight;
  if (bounds.bottom < 0 || bounds.top > height) {
    hideEquipmentTooltip();
    return;
  }
  const gap = 10;
  const x = bounds.right + tooltip.offsetWidth + gap < width
    ? bounds.right + gap
    : Math.max(gap, bounds.left - tooltip.offsetWidth - gap);
  const y = Math.max(gap, Math.min(bounds.top, height - tooltip.offsetHeight - gap));
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
}

export function hideEquipmentTooltip() {
  active?.removeAttribute("aria-describedby");
  active = null;
  pinned = false;
  tooltip.hidden = true;
}

function addLine({ text, right, effect }, className) {
  if (!text && !right) return;
  const line = document.createElement("div");
  line.className = className ?? (effect ? "tooltip-line tooltip-effect" : "tooltip-line");
  line.textContent = text?.replace(/\|n/gu, "\n");
  if (right) {
    const value = document.createElement("span");
    value.textContent = right;
    line.append(value);
  }
  tooltip.append(line);
}

function addRecipeReagents(item) {
  if (!item.recipe) return;
  if (item.reagents == null) {
    addLine({ text: "Quantités des composants non relevées. Ouvre ce métier avec le collecteur 0.5.19, puis réimporte /cvp export." }, "tooltip-source");
    return;
  }
  addLine({ text: "Composants · pour 1 fabrication" }, "tooltip-source");
  if (!item.reagents.length) addLine({ text: "Aucun composant requis." });
  for (const slot of item.reagents) {
    const line = document.createElement("div");
    line.className = "tooltip-reagent";
    for (const [index, option] of slot.options.entries()) {
      if (index) {
        const separator = document.createElement("span");
        separator.className = "tooltip-reagent-note";
        separator.textContent = " ou ";
        line.append(separator);
      }
      const reagent = document.createElement("span");
      reagent.className = "tooltip-reagent-option";
      const frame = document.createElement("span");
      frame.className = "tooltip-reagent-icon";
      frame.setAttribute("aria-hidden", "true");
      if (Number.isSafeInteger(option.icon) && option.icon > 0) {
        const icon = document.createElement("img");
        icon.src = `https://zephras.com/icons/card/${option.icon}.jpg`;
        icon.alt = "";
        icon.width = 18;
        icon.height = 18;
        icon.referrerPolicy = "no-referrer";
        icon.addEventListener("error", () => icon.remove(), { once: true });
        frame.append(icon);
      }
      const label = document.createElement("span");
      label.textContent = `${option.name} × ${option.quantity}`;
      reagent.append(frame);
      reagent.append(label);
      line.append(reagent);
    }
    if (slot.optional) {
      const note = document.createElement("span");
      note.className = "tooltip-reagent-note";
      note.textContent = " (facultatif)";
      line.append(note);
    }
    tooltip.append(line);
  }
}

async function showTooltip(row, item) {
  if (active === row) return;
  hideEquipmentTooltip();
  active = row;
  row.setAttribute("aria-describedby", tooltip.id);
  tooltip.dataset.quality = row.dataset.quality ?? "1";
  tooltip.hidden = false;
  const title = { text: item.name ?? row.querySelector("strong")?.textContent ?? row.getAttribute("aria-label") };
  tooltip.replaceChildren();
  addLine(title, "tooltip-name");
  if (item.detail) addLine({ text: item.detail }, "tooltip-source");
  if (item.tooltip?.length) {
    for (const line of item.tooltip) {
      // Spell tooltips can omit reagent counts. Use the recipe's structured costs.
      if (item.recipe && /^(?:reagents|composants|réactifs)\s*:/iu.test(line.text.trim())) continue;
      addLine(line);
    }
    addRecipeReagents(item);
    positionTooltip();
    return;
  }
  if (item.description || !item.itemId) {
    addLine({ text: item.description ?? "Fiche non relevée. Actualise le relevé en jeu avec le collecteur à jour." });
    addRecipeReagents(item);
    positionTooltip();
    return;
  }
  addLine({ text: "Chargement des caractéristiques…" }, "tooltip-source");
  positionTooltip();
  const lines = await itemLines(item.itemId);
  if (active !== row) return;
  tooltip.replaceChildren();
  addLine(title, "tooltip-name");
  for (const line of lines) addLine(line);
  addRecipeReagents(item);
  const enchant = itemEnchantLabel(item);
  if (enchant) addLine({ text: enchant, effect: true });
  addLine({ text: lines.length ? "Fiche de base · Zephras" : "Caractéristiques indisponibles" }, "tooltip-source");
  positionTooltip();
}

function bindTooltip(row, item) {
  if (!item) return;
  row.addEventListener("pointerenter", (event) => {
    if (event.pointerType !== "touch") showTooltip(row, item);
  });
  row.addEventListener("pointerleave", () => {
    if (active === row && !pinned && !row.matches(":focus-visible")) hideEquipmentTooltip();
  });
  row.addEventListener("focus", () => showTooltip(row, item));
  row.addEventListener("blur", () => {
    if (active === row && !row.matches(":hover")) hideEquipmentTooltip();
  });
  row.addEventListener("click", (event) => {
    if (event.pointerType !== "touch") return;
    event.stopPropagation();
    if (active === row && pinned) hideEquipmentTooltip();
    else {
      showTooltip(row, item);
      pinned = true;
    }
  });
}

export function bindEquipmentTooltips(profile, equipment) {
  const items = new Map(equipment.map((item) => [item.slot, item]));
  for (const row of profile.querySelectorAll(".item[data-quality]")) {
    bindTooltip(row, items.get(Number(row.dataset.slot)));
  }
  for (const enchant of profile.querySelectorAll(".item-enchant")) {
    bindTooltip(enchant, { name: "Enchantement", description: enchant.textContent });
  }
}

export function bindProfileTooltips(profile, professions, talents) {
  const recipes = new Map((professions?.items ?? []).flatMap((profession) =>
    (profession.recipes ?? []).map((recipe) => [`${profession.skillLineId}:${recipe.id}`, { ...recipe, recipe: true, detail: profession.name }])));
  for (const row of profile.querySelectorAll("[data-recipe-id]")) {
    bindTooltip(row, recipes.get(`${row.dataset.professionId}:${row.dataset.recipeId}`));
  }
  const nodes = new Map((talents?.trees ?? []).flatMap((tree) => tree.nodes.map((node) => {
    const entry = node.entries.find((entry) => entry.id === node.activeEntryId) ?? node.entries[0];
    return [`${tree.id}:${node.id}`, { ...entry, detail: `${node.rank}/${node.maxRank} · ${node.spent} point${node.spent === 1 ? " investi" : "s investis"}`,
      description: [entry.description, node.entries.length > 1 ? `Choix : ${node.entries.map((option) => option.name).join(" / ")}` : ""].filter(Boolean).join("\n") || undefined }];
  })));
  for (const node of profile.querySelectorAll(".talent-node")) {
    bindTooltip(node, nodes.get(`${node.dataset.treeId}:${node.dataset.nodeId}`));
  }
  for (const icon of profile.querySelectorAll(".recipe-icon img")) {
    icon.addEventListener("error", () => icon.remove(), { once: true });
  }
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && active) hideEquipmentTooltip();
});
document.addEventListener("pointerdown", (event) => {
  if (pinned && active && !active.contains(event.target)) hideEquipmentTooltip();
});
window.addEventListener("scroll", positionTooltip, true);
window.addEventListener("resize", positionTooltip);
