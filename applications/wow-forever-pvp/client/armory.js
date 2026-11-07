export const ARMORY_VIEW_PATH = "/api/wow-forever-pvp/armory";
export const ARMORY_SCENE_URL = "https://mattjcr.github.io/wowforeverultimatecalculator/models/1.60.1.70790/scene/";

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
const elwynn = { file: "human", zone: "Forêt d’Elwynn" };
const durotar = { file: "orc", zone: "Durotar" };
const dunMorogh = { file: "dwarf", zone: "Dun Morogh" };
const zephras = { file: "skyborne", zone: "Île de Zephras" };
const startingScenes = new Map([
  [1, elwynn],
  [2, durotar],
  [3, dunMorogh],
  [4, { file: "nightelf", zone: "Teldrassil" }],
  [5, { file: "scourge", zone: "Clairières de Tirisfal" }],
  [6, { file: "tauren", zone: "Mulgore" }],
  [7, dunMorogh],
  [8, durotar],
  [95, zephras],
  [96, zephras],
]);

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

export function itemEnchant(item) {
  return item.link?.match(/\|Hitem:\d+:([1-9]\d{0,8}):/u)?.[1];
}

export function armoryParams(race, sex, equipment, appearance) {
  const items = new Map(equipment.map((item) => [item.slot, item]));
  const gear = slots.flatMap((slot, index) => {
    const item = items.get(slot);
    if (!Number.isSafeInteger(item?.itemId) || item.itemId <= 0) return [];
    const enchant = itemEnchant(item);
    return [`${"abcdefghijklmnopqrs"[index]}${item.itemId}${enchant ? `e${enchant}` : ""}`];
  });
  const params = new URLSearchParams({ r: race, a: sex === 3 ? "1" : "0" });
  if (appearance?.raceId === race && appearance.sex === sex) {
    params.set("a", `${params.get("a")}.${appearance.choices.map(({ optionId, choiceId }) => `${optionId}-${choiceId}`).join("~")}`);
  }
  if (gear.length) params.set("g", gear.join("."));
  return params;
}

export function mountArmory(panel, character, snapshot) {
  const race = panel.querySelector("[name=armory-race]");
  const body = panel.querySelector("[name=armory-body]");
  const stage = panel.querySelector(".armory-stage");
  const backdrop = panel.querySelector(".armory-backdrop");
  const zone = panel.querySelector(".armory-zone");
  const status = panel.querySelector(".armory-appearance");
  const placeholder = stage.querySelector(".armory-placeholder");
  const form = panel.querySelector(".armory-controls");
  const link = panel.querySelector(".armory-link");
  const raceId = armoryRace(character);
  if (raceId && !races.some(([id]) => id === raceId))
    race.add(new Option(character.race ?? `Race #${raceId}`, raceId));
  for (const [id, label] of races) race.add(new Option(label, id));
  race.value = raceId ?? "";
  body.value = character.sex ?? "";
  if (character.raceId > 0 && body.value) {
    race.closest("label").hidden = true;
    body.closest("label").hidden = true;
  }
  function showScene() {
    const scene = startingScenes.get(raceId ?? Number(race.value));
    if (scene) backdrop.src = `${ARMORY_SCENE_URL}${scene.file}.webp`;
    else backdrop.removeAttribute("src");
    backdrop.hidden = !scene;
    zone.textContent = scene?.zone ?? "";
  }
  backdrop.addEventListener("error", () => { backdrop.hidden = true; });
  race.addEventListener("change", showScene);
  showScene();
  function loadModel() {
    const modelRace = Number(race.value);
    const modelSex = Number(body.value);
    const params = armoryParams(modelRace, modelSex, snapshot?.equipment ?? [], character.appearance);
    const supported = (modelRace >= 1 && modelRace <= 9) || modelRace === 95 || modelRace === 96;
    link.hidden = !supported;
    if (!supported) {
      status.textContent = "";
      placeholder.querySelector("p").textContent = "Cette race n’est pas encore prise en charge par le vestiaire 3D.";
      stage.replaceChildren(placeholder);
      return;
    }
    status.textContent = params.get("a").includes(".")
      ? "Apparence relevée au barbier."
      : "Apparence par défaut. Ouvre le barbier en jeu, puis refais un export.";
    const frame = document.createElement("iframe");
    frame.title = `Modèle 3D de ${character.name}`;
    frame.referrerPolicy = "no-referrer";
    frame.src = `${ARMORY_VIEW_PATH}?${params}`;
    link.href = frame.src;
    stage.replaceChildren(frame);
    form.querySelector("button").textContent = "Actualiser le modèle";
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    loadModel();
  });
  if (race.value && body.value) loadModel();
}
