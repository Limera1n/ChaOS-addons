export const ARMORY_EMBED_URL = "https://mattjcr.github.io/wowforeverultimatecalculator/embed/";
export const ARMORY_VIEW_PATH = "/api/wow-forever-pvp/armory";

// WoW inventory slot IDs in the dressing room's a–s order.
const slots = [1, 2, 3, 15, 5, 4, 19, 9, 10, 6, 7, 8, 11, 12, 13, 14, 16, 17, 18];
const races = [
  [1, "Humain", "human", "humaine"],
  [2, "Orc", "orque"],
  [3, "Nain", "dwarf", "naine"],
  [4, "Elfe de la nuit", "night elf"],
  [5, "Mort-vivant", "undead", "forsaken", "scourge", "morte-vivante"],
  [6, "Tauren", "taurène"],
  [7, "Gnome"],
  [8, "Troll", "trollesse"],
  [95, "Skyborne (Alliance)", "skyborne (high order)", "high order skyborne"],
  [96, "Skyborne (Horde)", "skyborne (windshaper)", "windshaper skyborne"],
];
const normalize = (value) =>
  value?.normalize("NFD").replace(/[\p{M}\s-]/gu, "").toLowerCase();

export function armoryRace(character) {
  if (character.raceId > 0) return character.raceId;
  const name = normalize(character.race);
  if (name === "skyborne") {
    const faction = normalize(character.faction);
    if (faction === "alliance") return 95;
    if (faction === "horde") return 96;
  }
  return races.find(([, ...names]) => names.some((label) => normalize(label) === name))?.[0];
}

export function armoryUrl(race, sex, equipment) {
  const items = new Map(equipment.map((item) => [item.slot, item]));
  const gear = slots.flatMap((slot, index) => {
    const item = items.get(slot);
    if (!Number.isSafeInteger(item?.itemId) || item.itemId <= 0) return [];
    const enchant = item.link?.match(/\|Hitem:\d+:([1-9]\d{0,8}):/u)?.[1];
    return [`${"abcdefghijklmnopqrs"[index]}${item.itemId}${enchant ? `e${enchant}` : ""}`];
  });
  const url = new URL(ARMORY_EMBED_URL);
  url.searchParams.set("r", race);
  url.searchParams.set("a", sex === 3 ? "1" : "0");
  if (gear.length) url.searchParams.set("g", gear.join("."));
  return url;
}

export function mountArmory(panel, character, snapshot) {
  const race = panel.querySelector("[name=armory-race]");
  const body = panel.querySelector("[name=armory-body]");
  const stage = panel.querySelector(".armory-stage");
  const form = panel.querySelector("form");
  const link = panel.querySelector(".armory-link");
  const raceId = armoryRace(character);
  if (raceId && !races.some(([id]) => id === raceId))
    race.add(new Option(character.race ?? `Race #${raceId}`, raceId));
  for (const [id, label] of races) race.add(new Option(label, id));
  race.value = raceId ?? "";
  body.value = character.sex ?? "";
  if (character.raceId > 0 && body.value) {
    const appearance = panel.querySelector(".armory-appearance");
    appearance.textContent = `${race.selectedOptions[0].text} · Silhouette ${body.selectedOptions[0].text.toLowerCase()} · Relevée en jeu`;
    appearance.hidden = false;
    race.closest("label").hidden = true;
    body.closest("label").hidden = true;
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const url = armoryUrl(Number(race.value), Number(body.value), snapshot?.equipment ?? []);
    const frame = document.createElement("iframe");
    frame.title = `Modèle 3D de ${character.name}`;
    frame.referrerPolicy = "no-referrer";
    frame.src = ARMORY_VIEW_PATH + url.search;
    link.href = url;
    link.hidden = false;
    stage.replaceChildren(frame);
    form.querySelector("button").textContent = "Actualiser la vue";
  });
}
