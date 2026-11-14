const ENGINE_ROOT = "https://wowbocho.com/tools/own-viewer/";
const ASSET_PATH = "/api/wow-forever-pvp/armory/assets/";
const METADATA_PATH = "/api/wow-forever-pvp/armory/metadata";

// Forever omits some shared enchant models (for example Crusader and Fiery).
// Only those visual models may use the common pack; character and gear IDs
// must keep their Forever definitions. The chosen pack also owns the textures
// and particles loaded by openModel.
export function installEnchantModels(engine, visuals, foreverBase, commonBase) {
  const models = new Set(Object.values(visuals).flat().filter(Boolean));
  const openModel = engine.openModel;
  engine.openModel = async (context, base, modelId, options) => {
    if (base === foreverBase && models.has(modelId) && !await engine.pack(base).M(modelId)) {
      base = commonBase;
    }
    return openModel.call(engine, context, base, modelId, options);
  };
}

export function selectAppearance(choices, recipe, variants = []) {
  const supported = new Map(recipe.options.map((option) => [option.id, new Set(option.choices.map((choice) => choice.id))]));
  const selected = new Map();
  let unmatched = 0;
  for (const choice of choices) {
    let { optionId, choiceId } = choice;
    if (!supported.get(optionId)?.has(choiceId)) {
      for (const variant of variants) {
        const pair = variant.Choices.find((entry) =>
          (variant.SourceOptionId === optionId && entry.SourceChoiceId === choiceId) ||
          (variant.VariantOptionId === optionId && entry.VariantChoiceId === choiceId));
        if (!pair) continue;
        const source = variant.SourceOptionId === optionId;
        optionId = source ? variant.VariantOptionId : variant.SourceOptionId;
        choiceId = source ? pair.VariantChoiceId : pair.SourceChoiceId;
        break;
      }
    }
    if (supported.get(optionId)?.has(choiceId)) selected.set(optionId, choiceId);
    else unmatched++;
  }
  return { options: [...selected].map(([optionId, choiceId]) => ({ optionId, choiceId })), unmatched };
}

async function loadScript(file) {
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = ENGINE_ROOT + file + ".js";
    script.onload = resolve;
    script.onerror = () => reject(new Error("Le moteur 3D est inaccessible."));
    document.head.append(script);
  });
}

// Attachment 11 is the helmet anchor, in the engine's Y-up world space.
// Prefer it to a fixed percentage of body height (dwarves, tauren, etc.).
export function frameHead(renderer) {
  renderer.draw();
  const actor = renderer.actors[0];
  const bounds = actor?.getBounds();
  if (!bounds) throw new Error("Dimensions de la tête indisponibles.");
  const height = bounds[1][2] - bounds[0][2];
  if (!Number.isFinite(height) || height <= 0) throw new Error("Dimensions du modèle invalides.");
  const head = actor._own?.r?.getAttachmentTransform?.(11);
  const hasHead = head && [head[12], head[13], head[14]].every(Number.isFinite);
  const center = hasHead
    ? [head[12], head[13], head[14]]
    : [0, bounds[0][2] + height * 0.86, 0];
  renderer._c = [center[0], 0, center[2]];
  renderer._lift = center[1];
  renderer.translation = [0, 0, 0];
  renderer.azimuth = Math.PI * 1.5;
  renderer.zenith = Math.PI / 2;
  // Tight face portrait: the former 34% framing included shoulders and chest.
  const span = height * 0.20;
  renderer.distance = span / (2 * Math.tan(renderer.fov * Math.PI / 360));
  renderer.zoom.current = renderer.zoom.target = 0;
  renderer.doUpdateBounds = false;
  actor.setAnimPaused(true);
  renderer.draw();
}

export function viewerEquipment(equipment, portrait) {
  return portrait ? equipment.filter((item) => item.slot === 1).map((item) => ({ ...item, enchantId: 0 })) : equipment;
}

export function capturePortrait(renderer, canvas) {
  renderer.draw();
  const fields = ["_c", "_lift", "translation", "azimuth", "zenith", "distance", "doUpdateBounds"];
  const saved = Object.fromEntries(fields.map((key) => [key, renderer[key]]));
  const { width, height, _paused: paused } = renderer;
  const zoom = { ...renderer.zoom };
  try {
    renderer.onResize(96, 96);
    frameHead(renderer);
    return canvas.toDataURL("image/png");
  } finally {
    renderer.onResize(width, height);
    Object.assign(renderer, saved);
    Object.assign(renderer.zoom, zoom);
    renderer.actors[0]?.setAnimPaused(Boolean(paused));
    renderer.draw();
  }
}

async function loadEngine(enchantEffects = true) {
  const assetBase = new URL(ASSET_PATH, location.origin).href;
  window.OWN_BASE = assetBase + "wowbocho-owni/";
  window.OWN_FV_BASE = assetBase + "wowbocho-ownfi/";
  window.OWN_CELL = (name) => assetBase + name + "/";
  // The upstream CommonJS loader reads its dependencies synchronously. Fetch
  // these in parallel first so startup does not block the browser's UI thread.
  const dependencies = [
    "npm/buffer-6.0.3/index.js", "npm/base64-js-1.5.1/index.js", "npm/ieee754-1.2.1/index.js",
    ...["buffer", "crc32", "3D/renderers/M2RendererGL", "casc/blp", "png-writer", "3D/loaders/M2Loader",
      "3D/Texture", "3D/Skin", "3D/loaders/M2Generics", "3D/loaders/ANIMLoader", "3D/AnimMapper",
      "3D/loaders/SKELLoader", "3D/GeosetMapper", "3D/ShaderMapper", "3D/Shaders", "3D/gl/ShaderProgram",
      "3D/gl/GLContext", "3D/gl/VertexArray", "3D/gl/GLTexture", "3D/renderers/renderer_utils", "3D/gl/UniformBuffer"]
      .map((file) => `wow.export/src/js/${file}.js`),
    "wow.export/src/shaders/m2.vertex.shader", "wow.export/src/shaders/m2.fragment.shader",
  ];
  window.OWN_VENDOR = Object.fromEntries(await Promise.all(dependencies.map(async (file) => {
    const url = ENGINE_ROOT + "vendor/" + file;
    const response = await fetch(url);
    if (!response.ok) throw new Error("Une dépendance du moteur 3D est inaccessible.");
    return [url, await response.text()];
  })));
  for (const file of ["loader", "wbm", "particles", "dress", "human", "zam"]) await loadScript(file);
  if (!enchantEffects) return;
  const response = await fetch(ENGINE_ROOT + "visuals.json");
  if (!response.ok) throw new Error("Le catalogue des effets d’enchantement est inaccessible.");
  const visuals = await response.json();
  installEnchantModels(window.OWNMV, visuals.d, window.OWN_FV_BASE, window.OWN_BASE);
}

async function startViewer() {
  const stage = document.querySelector("#stage");
  const status = document.querySelector("#status");
  const definition = document.querySelector("#definition");
  const retry = document.querySelector("#retry");
  const params = new URLSearchParams(location.search);
  const portrait = params.get("portrait") === "1";
  const race = Number(params.get("r"));
  const body = params.get("a");
  const female = body.startsWith("1");
  const hdModel = race >= 95 ? (female ? 219 : 218) : 2 * race - (female ? 0 : 1);
  const sdModel = hdModel <= 16 ? hdModel + 256 : ({ 17: 277, 18: 278 })[hdModel];
  definition.querySelector('[value="sd"]').disabled = !sdModel;
  definition.value = sdModel && params.get("m") !== "hd" ? "sd" : "hd";
  const choices = (body.split(".")[1] ?? "").split("~").filter(Boolean).map((pair) => {
    const [optionId, choiceId] = pair.split("-").map(Number);
    return { optionId, choiceId };
  });
  const slots = [1, 2, 3, 15, 5, 4, 19, 9, 10, 6, 7, 8, 11, 12, 13, 14, 16, 17, 18];
  const equipment = viewerEquipment((params.get("g") ?? "").split(".").filter(Boolean).map((code) => {
    const [itemId, enchantId] = code.slice(1).split("e").map(Number);
    return { slot: slots[code.charCodeAt(0) - 97], itemId, enchantId };
  }), portrait);
  const enchantments = equipment.some((item) => item.enchantId)
    ? fetch("https://wowbocho.com/data/items/ench.json").then((response) => response.ok ? response.json() : null).catch(() => null)
    : Promise.resolve(null);
  let engine;
  let catalog;
  let metadata;
  let view;
  let generation = 0;
  let stopped = false;
  async function render() {
    const current = ++generation;
    const stale = () => stopped || current !== generation;
    retry.hidden = true;
    status.textContent = "Chargement du personnage…";
    try {
      engine ??= loadEngine(!portrait).catch((error) => { engine = null; throw error; });
      catalog ??= equipment.length ? fetch("https://wowbocho.com/data/forever/items/disp.json").then((response) => {
        if (!response.ok) throw new Error("Le catalogue d’équipement est inaccessible.");
        return response.json();
      }).catch((error) => { catalog = null; throw error; }) : Promise.resolve({ d: {} });
      metadata ??= choices.length ? fetch(`${METADATA_PATH}?model=${hdModel}`).then((response) => {
        if (!response.ok) throw new Error("La correspondance des apparences HD/SD est inaccessible.");
        return response.json();
      }).catch((error) => { metadata = null; throw error; }) : Promise.resolve([]);
      const [, gear, variants, effects] = await Promise.all([engine, catalog, metadata, enchantments]);
      const model = definition.value === "sd" ? sdModel : hdModel;
      const recipe = await window.OWNMV.json(window.OWN_FV_BASE, "c", model);
      if (!recipe) throw new Error("Ce modèle est indisponible.");
      const selection = selectAppearance(choices, recipe, variants);
      let missingItems = 0;
      const items = equipment.flatMap((item) => {
        if ([2, 11, 12, 13, 14].includes(item.slot)) return [];
        const data = gear.d[item.itemId];
        if (!data) { missingItems++; return []; }
        // A one-handed weapon equipped in the off-hand must keep that hand.
        const inventoryType = item.slot === 17 && [13, 17, 21].includes(data[1]) ? 22 : data[1];
        return [[inventoryType, data[0], effects?.e[item.enchantId] ?? 0]];
      });
      const available = await Promise.all(items.map((item) => window.OWNMV.json(window.OWN_FV_BASE, "i", item[1])));
      const visibleItems = items.filter((_item, index) => available[index]);
      missingItems += items.length - visibleItems.length;
      if (stale()) return;
      const container = document.createElement("div");
      container.className = "model";
      stage.append(container);
      const next = await new window.ZamModelViewer({
        container, contentPath: "classicplus", aspect: stage.clientWidth / stage.clientHeight,
        models: { type: 16, id: model }, items: visibleItems,
        charCustomization: { options: selection.options, sheathMain: -1, sheathOff: -1 }, stale,
      });
      await next.renderer._v?.done;
      if (stale()) {
        next.destroy();
        container.remove();
        return;
      }
      view?.destroy();
      view = next;
      stage.replaceChildren(container);
      if (portrait) {
        const renderer = next.renderer;
        const image = new Image();
        image.alt = "Portrait du personnage";
        image.src = capturePortrait(renderer, container.querySelector("canvas"));
        window.parent.postMessage({ type: "chaos-avatar-ready", image: image.src }, location.origin);
        stage.replaceChildren(image);
        next.destroy();
        view = null;
        status.textContent = "";
        return;
      }
      // The visible character is already loaded. Reuse its renderer to create
      // the avatar too, avoiding another engine/download and a queue timeout.
      try {
        const image = capturePortrait(next.renderer, container.querySelector("canvas"));
        window.parent.postMessage({ type: "chaos-avatar-ready", image }, location.origin);
      } catch (error) {
        console.warn("Capture de l’avatar depuis le personnage", error);
      }
      const warnings = [];
      if (selection.unmatched) warnings.push(`${selection.unmatched} choix du barbier sans équivalent dans ce modèle`);
      if (missingItems) warnings.push(`${missingItems} pièce(s) sans modèle disponible`);
      status.textContent = warnings.join(" · ");
    } catch (error) {
      if (stale()) return;
      console.warn("Chargement du portrait 3D", error);
      if (portrait) window.parent.postMessage({ type: "chaos-avatar-error" }, location.origin);
      status.textContent = "Le personnage n’a pas pu être chargé. Réessaie dans un instant.";
      retry.hidden = false;
      stage.querySelectorAll(".model").forEach((container) => { if (!container.querySelector("canvas")) container.remove(); });
    }
  }
  definition.addEventListener("change", render);
  retry.addEventListener("click", render);
  if (!portrait) new ResizeObserver(() => {
    view?.renderer.onResize(stage.clientWidth, stage.clientHeight);
  }).observe(stage);
  window.addEventListener("pagehide", () => { stopped = true; generation++; view?.destroy(); });
  await render();
}

if (typeof document !== "undefined") startViewer();
