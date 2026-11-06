import { itemEnchant } from "./armory.js";

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
  line.textContent = text;
  if (right) {
    const value = document.createElement("span");
    value.textContent = right;
    line.append(value);
  }
  tooltip.append(line);
}

async function showTooltip(row, item) {
  if (active === row) return;
  hideEquipmentTooltip();
  active = row;
  row.setAttribute("aria-describedby", tooltip.id);
  tooltip.dataset.quality = row.dataset.quality;
  tooltip.hidden = false;
  const title = { text: row.querySelector("strong").textContent };
  tooltip.replaceChildren();
  addLine(title, "tooltip-name");
  if (item.tooltip?.length) {
    for (const line of item.tooltip) addLine(line);
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
  const enchant = itemEnchant(item);
  if (enchant) addLine({ text: `Enchantement #${enchant}`, effect: true });
  addLine({ text: lines.length ? "Fiche de base · Zephras" : "Caractéristiques indisponibles" }, "tooltip-source");
  positionTooltip();
}

export function bindEquipmentTooltips(profile, equipment) {
  const items = new Map(equipment.map((item) => [item.slot, item]));
  for (const row of profile.querySelectorAll(".item[data-quality]")) {
    const item = items.get(Number(row.dataset.slot));
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
      if (active === row && pinned) hideEquipmentTooltip();
      else {
        showTooltip(row, item);
        pinned = true;
      }
    });
  }
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && active) hideEquipmentTooltip();
});
document.addEventListener("pointerdown", (event) => {
  if (pinned && !active.contains(event.target)) hideEquipmentTooltip();
});
window.addEventListener("scroll", positionTooltip, true);
window.addEventListener("resize", positionTooltip);
