import { createAvatarCache, validAvatarImage } from "./avatar-cache.js";

export const ARMORY_VIEW_PATH = "/api/wow-forever-pvp/armory";
export const ARMORY_SCENE_URL = new URL("./scenes/", import.meta.url).href;

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
  if (Number.isSafeInteger(item.enchantId) && item.enchantId >= 0 && item.enchantId <= 999999999)
    return item.enchantId ? String(item.enchantId) : undefined;
  const linked = item.link?.match(/\|Hitem:\d+:(\d{1,9})(?=:|\|h|$)/u)?.[1];
  if (linked !== undefined) return Number(linked) ? String(Number(linked)) : undefined;
  // Older exports copied through WoW's EditBox lost the hyperlink payload.
  // Recover this known enchant only from an explicit enchant tooltip line,
  // never from ordinary weapon damage or item stats.
  if ([16, 17].includes(item.slot) && item.tooltip?.some(({ text }) =>
    /^Enchanted:\s*Weapon Damage \+5$/iu.test(text.trim()))) return "1897";
}

export function itemEnchantLabel(item) {
  const line = item.tooltip?.find(({ text }) => /^(?:Enchanted|Enchanté|Enchantement)\s*:/iu.test(text.trim()));
  const label = line?.text.trim().replace(/^(?:Enchanted|Enchanté|Enchantement)\s*:\s*/iu, "");
  if (label) return label.replace(/^Weapon Damage \+(\d+)$/iu, "Dégâts de l’arme +$1");
  const enchant = itemEnchant(item);
  if (enchant === "1897") return "Dégâts de l’arme +5";
  return enchant ? "Enchantement" : undefined;
}

export function armoryParams(race, sex, equipment, appearance) {
  const items = new Map(equipment.map((item) => [item.slot, item]));
  const gear = slots.flatMap((slot, index) => {
    const item = items.get(slot);
    if (!Number.isSafeInteger(item?.itemId) || item.itemId <= 0) return [];
    // Zero is an explicitly hidden appearance. Older exports use the equipped item.
    const visualItemId = Number.isSafeInteger(item.transmogItemId) && item.transmogItemId >= 0
      ? item.transmogItemId : item.itemId;
    if (!visualItemId) return [];
    const enchant = itemEnchant(item);
    return [`${"abcdefghijklmnopqrs"[index]}${visualItemId}${enchant ? `e${enchant}` : ""}`];
  });
  const params = new URLSearchParams({ r: race, a: sex === 3 ? "1" : "0" });
  if (appearance?.raceId === race && appearance.sex === sex) {
    params.set("a", `${params.get("a")}.${appearance.choices.map(({ optionId, choiceId }) => `${optionId}-${choiceId}`).join("~")}`);
  }
  if (gear.length) params.set("g", gear.join("."));
  return params;
}

export function avatarParams(character, snapshot) {
  // Only the helmet affects this head portrait. Ignore weapons, enchants and
  // lower-body equipment both in the render request and in the image cache key.
  const helmet = (snapshot?.equipment ?? []).filter((item) => item.slot === 1)
    .map(({ slot, itemId, transmogItemId }) => ({ slot, itemId, transmogItemId }));
  const appearance = character.appearance && {
    ...character.appearance,
    choices: [...character.appearance.choices].sort((a, b) => a.optionId - b.optionId),
  };
  const params = armoryParams(armoryRace(character), character.sex, helmet, appearance);
  params.set("portrait", "1");
  return params;
}

function generateAvatar(key) {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.className = "avatar-generator";
    frame.tabIndex = -1;
    frame.setAttribute("aria-hidden", "true");
    frame.referrerPolicy = "no-referrer";
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      frame.remove();
    };
    const receive = (event) => {
      if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
      if (event.data?.type === "chaos-avatar-ready" && validAvatarImage(event.data.image)) {
        cleanup();
        resolve(event.data.image);
      } else if (event.data?.type === "chaos-avatar-error") {
        cleanup();
        reject(new Error("Portrait indisponible."));
      }
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error("Portrait trop long à charger.")); }, 60000);
    window.addEventListener("message", receive);
    // Independent of roster/profile DOM: navigating cannot interrupt the render.
    frame.src = `${ARMORY_VIEW_PATH}?${key}`;
    document.body.append(frame);
  });
}

let avatarCache;
let avatarObserver;
const waitingAvatars = new Map();
const armoryFrames = new Map();
let armoryMessagesInstalled = false;

function getAvatarCache() {
  if (!avatarCache) {
    let storage;
    try { storage = window.localStorage; } catch { /* Memory cache still works. */ }
    avatarCache = createAvatarCache({ generate: generateAvatar, storage });
  }
  return avatarCache;
}

function showAvatar(container, src, name) {
  if (!container.isConnected) return;
  const image = document.createElement("img");
  image.alt = `Avatar de ${name}`;
  image.src = src;
  container.replaceChildren(image);
  container.title = "";
  container.removeAttribute?.("aria-busy");
}

function receiveArmoryAvatar(frame, key) {
  for (const [source, entry] of armoryFrames) if (!entry.frame.isConnected) armoryFrames.delete(source);
  armoryFrames.set(frame.contentWindow, { frame, key });
  if (armoryMessagesInstalled) return;
  armoryMessagesInstalled = true;
  window.addEventListener("message", (event) => {
    const entry = armoryFrames.get(event.source);
    if (!entry?.frame.isConnected || event.origin !== location.origin || event.data?.type !== "chaos-avatar-ready" || !validAvatarImage(event.data.image)) return;
    getAvatarCache().remember(entry.key, event.data.image);
    for (const container of document.querySelectorAll(".character-avatar")) {
      if (container.dataset.avatarKey === entry.key) showAvatar(container, event.data.image, container.dataset.avatarName);
    }
  });
}

export function mountAvatar(container, character, snapshot) {
  const race = armoryRace(character);
  if (!((race >= 1 && race <= 9) || race === 95 || race === 96) || ![2, 3].includes(character.sex)) return;
  const params = avatarParams(character, snapshot);
  getAvatarCache();
  const key = params.toString();
  container.dataset.avatarKey = key;
  container.dataset.avatarName = character.name;
  const show = (src) => showAvatar(container, src, character.name);
  const cached = avatarCache.peek(key);
  if (cached) { show(cached); return; }
  const load = () => {
    container.title = "Chargement de l’avatar…";
    container.setAttribute?.("aria-busy", "true");
    return avatarCache.get(key).then(show).catch((error) => {
      if (!container.isConnected || container.querySelector?.("img")) return;
      container.removeAttribute?.("aria-busy");
      container.title = "Avatar indisponible. Ouvre l’onglet Personnage pour le recréer depuis le modèle.";
      console.warn("Chargement de l’avatar", error);
    });
  };
  if (typeof IntersectionObserver === "undefined") { load(); return; }
  avatarObserver ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const start = waitingAvatars.get(entry.target);
      avatarObserver.unobserve(entry.target);
      waitingAvatars.delete(entry.target);
      if (entry.target.isConnected) start?.();
    }
  });
  for (const target of waitingAvatars.keys()) {
    if (!target.isConnected) {
      avatarObserver.unobserve(target);
      waitingAvatars.delete(target);
    }
  }
  waitingAvatars.set(container, load);
  avatarObserver.observe(container);
}

export function mountArmory(panel, character, snapshot) {
  const race = panel.querySelector("[name=armory-race]");
  const body = panel.querySelector("[name=armory-body]");
  const definition = panel.querySelector("[name=armory-definition]");
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
  function updateDefinition() {
    const sd = Number(race.value) < 95;
    definition.querySelector('[value="sd"]').disabled = !sd;
    if (!sd) definition.value = "hd";
  }
  updateDefinition();
  if (character.raceId > 0 && body.value) {
    race.closest("label").hidden = true;
    body.closest("label").hidden = true;
  }
  function showScene() {
    const scene = startingScenes.get(Number(race.value));
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
    params.set("m", definition.value);
    params.set("controls", "0");
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
    receiveArmoryAvatar(frame, avatarParams({ ...character, raceId: modelRace, sex: modelSex }, snapshot).toString());
    form.querySelector("button").textContent = "Actualiser le modèle";
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    loadModel();
  });
  race.addEventListener("change", updateDefinition);
  definition.addEventListener("change", () => { if (race.value && body.value) loadModel(); });
  if (race.value && body.value) loadModel();
}
