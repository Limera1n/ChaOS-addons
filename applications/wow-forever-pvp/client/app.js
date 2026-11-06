import { groupZones, honorProgress, itemQuality, summarize } from "./model.js";
import { itemEnchant, mountArmory } from "./armory.js";
import { AZEROTH, mapContains, mapRegions, projectPosition } from "./map-regions.js";
import { mapOutlines } from "./map-outlines.js";
import { bindEquipmentTooltips, hideEquipmentTooltip } from "./item-tooltips.js";

// Same paths as server/routes.js; the client cannot import server code.
const API_PATH = "/api/wow-forever-pvp";
const IMPORT_TYPE = "application/vnd.chaos-world-pvp+json";
const MAP_ART = "https://wowforever-media.fly.storage.tigris.dev/maps/1.60.1.69893/zones/";
const deathCauses = new Map([
  ["pvp", "PvP"],
  ["pve", "PvE"],
  ["environment", "environnement"],
  ["self", "dégâts auto-infligés"],
]);

const $ = (selector) => document.querySelector(selector);
const date = (at) =>
  at == null ? "Non relevé" : new Date(at * 1000).toLocaleString("fr-FR");
const count = (value) => (value == null ? "—" : value.toLocaleString("fr-FR"));
function eventLabel(item) {
  if (item.type !== "death") return `+${count(item.amount)} VH`;
  const cause = deathCauses.get(item.cause) ?? "cause inconnue";
  return `Mort · ${cause}${item.source ? ` · ${item.source}` : ""}`;
}
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/gu,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const slots = [
  "",
  "Tête",
  "Cou",
  "Épaules",
  "Chemise",
  "Torse",
  "Taille",
  "Jambes",
  "Pieds",
  "Poignets",
  "Mains",
  "Anneau 1",
  "Anneau 2",
  "Bijou 1",
  "Bijou 2",
  "Dos",
  "Main droite",
  "Main gauche",
  "Distance",
  "Tabard",
];
const equipmentColumns = {
  left: [1, 2, 3, 15, 5, 4, 19, 9],
  right: [10, 6, 7, 8, 11, 12, 13, 14],
  weapons: [16, 17, 18],
};
const emptySlotIcons = ["", "◈", "♢", "◆", "♜", "♜", "▰", "Ⅱ", "◧", "▤", "✥", "◯", "◯", "✦", "✦", "◩", "⚔", "⛨", "➶", "♜"];

function equipmentRow(slot, item) {
  const placeholder = `<span aria-hidden="true">${emptySlotIcons[slot]}</span>`;
  if (!item) return `<li class="item item-empty" data-slot="${slot}" aria-label="${slots[slot]} vide" title="${slots[slot]} · vide"><span class="item-icon">${placeholder}</span></li>`;
  const quality = itemQuality(item);
  const name = item.link?.match(/\[([^\]]+)\]/u)?.[1] ?? `Objet #${item.itemId}`;
  const icon = Number.isSafeInteger(item.icon) && item.icon > 0
    ? `<img src="https://zephras.com/icons/card/${item.icon}.jpg" alt="" width="56" height="56" referrerpolicy="no-referrer">`
    : "";
  const enchant = itemEnchant(item);
  return `<li class="item" tabindex="0" data-slot="${slot}" data-quality="${quality}">
    <span class="item-icon" aria-hidden="true">${placeholder}${icon}</span>
    <div class="item-info">
      <strong>${escape(name)}</strong>
      ${enchant ? `<small>Enchantement #${enchant}</small>` : ""}
    </div>
  </li>`;
}
let state = { characters: [] };
let selectedKey = null;
let selectedMap = AZEROTH;
let selectedEvents = [];
let mapNames = new Map();
let honorScope = "character";
let profileView = "character";

function factionMark(faction) {
  if (faction === "horde") {
    return `<path fill="#a81615" stroke="#d45129" d="M48 3 65 17l10-2 1 11 11 13-7 3 8 8-17 7-8-7-7 11 6 11-9 11-5 15-5-15-9-11 6-11-7-11-8 7-17-7 8-8-7-3 11-13 1-11 10 2Zm0 17L30 39l18 22 18-22Zm0 7 9 12-9 10-9-10Z" fill-rule="evenodd"/>`;
  }
  if (faction === "alliance") {
    return `<path fill="#235695" stroke="#f4b92e" stroke-width="4" d="M48 7 80 18v30c0 23-15 37-32 46C31 85 16 71 16 48V18Z"/><path fill="#efbd51" d="m29 28 12 5 7-12 7 12 12-5-5 13 2 16-8 13-8 6-8-6-8-13 2-16Zm8 17 3 8 5-4Zm22 0-8 4 5 4Zm-18 14 7 7 7-7Z" fill-rule="evenodd"/>`;
  }
  return `<path fill="none" stroke="#c9a158" stroke-width="4" d="M48 8 84 49 48 90 12 49Z M31 65l34-34M31 31l34 34"/>`;
}

function setProfileView(view) {
  hideEquipmentTooltip();
  profileView = view;
  const panel = $(".armory");
  panel.dataset.view = view;
  for (const button of panel.querySelectorAll("[data-profile-view]")) {
    button.setAttribute("aria-pressed", String(button.dataset.profileView === view));
  }
  $("#armory-character").hidden = view !== "character";
  $("#armory-pvp").hidden = view !== "pvp";
  $("#activity").hidden = view !== "pvp";
}

function renderHonorProgress(character, guild) {
  const panel = $(".honor-progress");
  const isGuild = honorScope === "guild" && guild != null;
  const scope = isGuild ? "guild" : "character";
  panel.dataset.scope = scope;
  for (const button of panel.querySelectorAll("button[data-scope]")) {
    button.setAttribute("aria-pressed", String(button.dataset.scope === scope));
    button.onclick = () => {
      honorScope = button.dataset.scope;
      renderHonorProgress(character, guild);
    };
  }
  const guildmates = isGuild
    ? state.characters.filter((item) =>
        item.region === character.region && item.realm === character.realm && item.ruleset === character.ruleset)
    : [character];
  const history = honorProgress(guildmates, isGuild ? guild : null);
  panel.querySelector(".honor-scope").textContent = isGuild ? guild : character.name;
  panel.querySelector(".honor-total").textContent = history ? `${count(history.total)} VH` : "—";
  panel.querySelector(".honor-note").textContent = history?.total === 0
    ? "Aucune VH en monde ouvert observée sur cette période."
    : isGuild
      ? "Somme des VH relevées chez les membres suivis, selon leur guilde au moment du relevé."
      : "Cumul des VH observées en monde ouvert pendant la collecte.";
  panel.querySelector(".honor-plot").hidden = !history;
  if (!history) {
    panel.querySelector(".honor-note").textContent = "La courbe apparaîtra après le premier relevé.";
    return;
  }
  const { start, end, points, total } = history;
  const plotWidth = 544;
  const scale = Math.max(1, total);
  const y = (value) => (88 - 76 * value / scale).toFixed(2);
  const columns = new Map();
  for (const point of points) {
    const column = Math.round((point.at - start) / Math.max(1, end - start) * plotWidth);
    columns.set(column + 8, point.total);
  }
  const line = `M 8 88${[...columns].map(([x, value]) => ` H ${x} V ${y(value)}`).join("")} H 552`;
  panel.querySelector(".honor-line").setAttribute("d", line);
  panel.querySelector(".honor-area").setAttribute("d", `${line} V 88 Z`);
  panel.querySelector(".honor-start").textContent = date(start);
  panel.querySelector(".honor-end").textContent = end === start ? "" : date(end);
  panel.querySelector(".honor-chart").setAttribute("aria-label", `${count(total)} VH observées · ${isGuild ? guild : character.name}`);
}

async function load() {
  const response = await fetch(API_PATH + "/state");
  if (!response.ok) throw new Error("Impossible de charger les relevés.");
  state = await response.json();
  if (!state.characters.some((item) => item.key === selectedKey))
    selectedKey = state.characters[0]?.key ?? null;
  render();
}
function renderRoster() {
  const query = $("#search").value.toLocaleLowerCase("fr");
  const roster = state.characters.filter((item) =>
    `${item.name} ${summarize(item).latest?.guild ?? ""}`
      .toLocaleLowerCase("fr")
      .includes(query),
  );
  $("#roster-count").textContent = state.characters.length;
  $("#roster").replaceChildren();
  for (const character of roster.sort(
    (a, b) => summarize(b).worldHK - summarize(a).worldHK,
  )) {
    const button = document.createElement("button");
    button.className = "roster-item";
    button.setAttribute("aria-pressed", String(character.key === selectedKey));
    button.innerHTML = `${escape(character.name)}<small>${escape(character.class ?? "Classe inconnue")} · ${count(summarize(character).worldHK)} VH observées</small>`;
    button.addEventListener("click", () => {
      if (selectedKey === character.key) return;
      selectedKey = character.key;
      selectedMap = AZEROTH;
      render();
    });
    $("#roster").append(button);
  }
}
function armoryEquipment(snapshot) {
  const items = new Map((snapshot?.equipment ?? []).map((item) => [item.slot, item]));
  const column = (side, label) => `<ul class="equipment equipment-${side}" aria-label="${label}">${equipmentColumns[side].map((slot) => equipmentRow(slot, items.get(slot))).join("")}</ul>`;
  return `<div id="armory-character">
    <div class="armory-loadout">
      ${column("left", "Équipement de gauche")}
      <div class="armory-stage">
        <div class="armory-placeholder">
          <span aria-hidden="true">⚔</span>
          <p>Choisis la race et la silhouette pour afficher le personnage.</p>
        </div>
      </div>
      ${column("right", "Équipement de droite")}
      ${column("weapons", "Armes")}
    </div>
    <div class="armory-footer">
      <span><b class="armory-zone"></b> Équipement relevé le ${escape(date(snapshot?.at))}</span>
      <span class="armory-appearance"></span>
      <form class="armory-controls">
        <label>Race du modèle
          <select name="armory-race" required><option value="">Choisir une race</option></select>
        </label>
        <label>Silhouette
          <select name="armory-body" required>
            <option value="">Choisir une silhouette</option>
            <option value="2">Masculine</option>
            <option value="3">Féminine</option>
          </select>
        </label>
        <button type="submit">Afficher en 3D</button>
      </form>
      <a class="armory-link" target="_blank" rel="noopener noreferrer" hidden>Ouvrir le vestiaire ↗</a>
    </div>
  </div>`;
}

function render() {
  hideEquipmentTooltip();
  renderRoster();
  const character = state.characters.find((item) => item.key === selectedKey);
  if (!character) return;
  const summary = summarize(character);
  const latest = summary.latest;
  const guild = latest?.guild;
  $("#profile").innerHTML =
    `<section class="armory" aria-labelledby="armory-title">
    <img class="armory-backdrop" alt="" referrerpolicy="no-referrer" hidden>
    <div class="identity">
      <svg class="sigil" viewBox="0 0 96 100" role="img" aria-label="${escape(character.faction ?? "Faction inconnue")}">${factionMark(character.faction?.toLowerCase())}</svg>
      <h2 id="armory-title">${escape(character.name)}</h2>
      <div class="armory-identity-meta">
        <strong>⚔ ${count(latest?.equipment.length ?? 0)} / 19 PIÈCES</strong>
        <p>${count(character.level)} ${escape(character.race ?? "Race inconnue")} ${escape(character.class ?? "Classe inconnue")}${guild ? ` <span>&lt;${escape(guild)}&gt;</span>` : ""} · ${escape(character.realm)}</p>
      </div>
    </div>
    <nav class="armory-tabs" aria-label="Vues de la fiche">
      <button type="button" data-profile-view="character" aria-controls="armory-character">Personnage</button>
      <button type="button" data-profile-view="pvp" aria-controls="armory-pvp activity">Joueur contre joueur</button>
    </nav>
    ${armoryEquipment(latest)}
    <div id="armory-pvp" hidden>
    <div class="metrics"><div class="metric"><strong>${count(summary.lifetimeHK)}</strong><span>VH cumulées · tous contextes</span></div><div class="metric"><strong>${count(summary.worldHK)}</strong><span>VH observées · monde ouvert</span></div><div class="metric"><strong>${count(summary.deaths)}</strong><span>Morts observées · monde ouvert</span></div><div class="metric"><strong>${summary.delta == null ? "—" : "+" + count(summary.delta)}</strong><span>Écart du compteur · tous contextes</span></div></div>
    <p class="muted">Compteur relevé le ${escape(date(summary.counterAt))}. Dernier import le ${escape(date(character.lastImportedAt))}. Règles de jeu ${escape(character.ruleset === "unknown" ? "non renseignées" : character.ruleset)}.</p>
    <section class="honor-progress" aria-labelledby="honor-title">
      <div class="honor-heading">
        <div><p class="eyebrow">MONDE OUVERT</p><h3 id="honor-title">Évolution des VH</h3></div>
        <div class="honor-switch" role="group" aria-label="Périmètre des VH">
          <button type="button" data-scope="character">Personnage</button>
          <button type="button" data-scope="guild" ${latest?.guild == null ? "disabled" : ""}>Guilde</button>
        </div>
      </div>
      <div class="honor-reading"><span class="honor-scope"></span><strong class="honor-total"></strong></div>
      <div class="honor-plot">
        <svg class="honor-chart" viewBox="0 0 560 100" preserveAspectRatio="none" role="img">
          <defs><linearGradient id="honor-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stop-color="currentColor" stop-opacity=".25" />
            <stop offset="1" stop-color="currentColor" stop-opacity="0" />
          </linearGradient></defs>
          <path class="honor-grid" d="M 8 12 H 552 M 8 50 H 552 M 8 88 H 552" />
          <path class="honor-area" fill="url(#honor-fill)" />
          <path class="honor-line" />
        </svg>
        <div class="honor-dates"><span class="honor-start"></span><span class="honor-end"></span></div>
      </div>
      <p class="muted honor-note"></p>
    </section>
    </div>
    </section>`;
  mountArmory($(".armory"), character, latest);
  bindEquipmentTooltips($("#profile"), latest?.equipment ?? []);
  for (const button of $(".armory").querySelectorAll("[data-profile-view]")) {
    button.addEventListener("click", () => setProfileView(button.dataset.profileView));
  }
  renderHonorProgress(character, latest?.guild);
  for (const icon of $("#profile").querySelectorAll(".item-icon img"))
    icon.addEventListener("error", () => icon.remove(), { once: true });
  selectedEvents = summary.events;
  const zones = groupZones(selectedEvents);
  mapNames = new Map([...mapRegions].map(([id, region]) => [id, region.name]));
  for (const zone of zones) {
    const id = String(zone.key);
    if (zone.name !== "Zone inconnue" || !mapNames.has(id)) mapNames.set(id, zone.name);
  }
  const picker = $("#map-filter");
  picker.replaceChildren(new Option("Azeroth · toutes les zones", AZEROTH));
  const regions = [...mapNames]
    .filter(([id]) => id !== AZEROTH)
    .sort((a, b) => a[1].localeCompare(b[1], "fr"));
  for (const [id, name] of regions) picker.add(new Option(name, id));
  if (!mapNames.has(selectedMap)) selectedMap = AZEROTH;
  $("#zones").innerHTML = zones.length
    ? zones
        .map(
          (zone) =>
            `<button type="button" class="zone" data-map="${escape(zone.key)}"><strong>${escape(zone.name)}</strong><span>${count(zone.hk)} VH · ${count(zone.deaths)} mort${zone.deaths === 1 ? "" : "s"}</span></button>`,
        )
        .join("")
    : '<p class="muted">Aucun événement en monde ouvert collecté.</p>';
  setProfileView(profileView);
  selectMap(selectedMap);
}
function selectMap(mapId) {
  selectedMap = mapId;
  $("#map-filter").value = mapId;
  for (const button of $("#zones").querySelectorAll("[data-map]"))
    button.setAttribute("aria-pressed", String(button.dataset.map === mapId));
  const events = selectedEvents.filter(
    (item) =>
      mapId === AZEROTH ||
      mapContains(mapId, String(item.location?.mapId ?? "unknown")),
  );
  renderEvents(events);
  renderMap(events);
}
function renderEvents(events) {
  $("#events").innerHTML =
    events
      .slice(-200)
      .reverse()
      .map((item) => {
        const location = item.location;
        const position =
          location?.x == null
            ? "Indisponible"
            : `${(location.x * 100).toFixed(1)}, ${(location.y * 100).toFixed(1)} · ${item.at - location.at}s avant`;
        return `<tr><td>${escape(date(item.at))}</td><td>${escape(eventLabel(item))}</td><td>${escape(location?.zone ?? "Zone inconnue")}</td><td>${escape(position)}</td></tr>`;
      })
      .join("") ||
    '<tr><td colspan="4">Aucun événement pour cette sélection.</td></tr>';
}
function svgElement(tag, attributes) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}
function zoomTo(mapId) {
  selectMap(mapId);
  $(mapId === AZEROTH ? "#map-filter" : "#map-zoom-out").focus({ preventScroll: true });
}
function bindMapTarget(element, id) {
  const name = mapNames.get(id);
  element.setAttribute("role", "button");
  element.setAttribute("tabindex", "0");
  element.setAttribute("aria-label", `Zoomer sur ${name}`);
  const label = $("#map-target");
  const updateLabel = () => {
    const active = element.matches(":hover, :focus-visible");
    label.hidden = !active;
    if (active) label.textContent = name;
  };
  for (const event of ["pointerenter", "pointerleave", "focus", "blur"])
    element.addEventListener(event, updateLabel);
  element.addEventListener("click", () => zoomTo(id));
  element.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    zoomTo(id);
  });
}
function renderMap(events) {
  const map = $("#map");
  map.replaceChildren();
  $("#map-target").hidden = true;
  const note = $("#map-note");
  const art = $("#map-art");
  const mapId = selectedMap;
  const name = mapNames.get(mapId);
  $("#map-current").textContent = name;
  $("#map-zoom-out").disabled = mapId === AZEROTH;
  map.setAttribute("aria-label", `Carte de ${name}`);
  if (!/^\d+$/u.test(mapId)) {
    art.replaceChildren();
    note.textContent = "Aucune carte relevée pour cette sélection.";
    return;
  }
  const children = [...mapOutlines].filter(([id]) => mapRegions.get(id).parent === mapId);
  const positioned = events.filter((event) => event.location?.x != null);
  const points = positioned.flatMap((item) => {
    const position = projectPosition(item.location, mapId);
    return position ? [{ item, ...position }] : [];
  });
  const description = [
    children.length ? "Survolez une zone pour voir son nom. Cliquez pour zoomer." : "",
    positioned.length > points.length ? "Certaines positions sont visibles uniquement sur leur carte de zone." : "",
    !positioned.length ? "Aucune coordonnée relevée sur cette carte." : "",
  ].filter(Boolean).join(" ");
  note.textContent = description;
  const image = document.createElement("img");
  image.alt = "";
  image.referrerPolicy = "no-referrer";
  image.addEventListener("error", () => {
    if (art.firstElementChild !== image) return;
    image.remove();
    note.textContent = `Fond de carte indisponible. ${description}`.trim();
  }, { once: true });
  art.replaceChildren(image);
  image.src = `${MAP_ART}${mapId}.webp`;

  for (const [id, path] of children) {
    const outline = svgElement("path", { class: "map-region", d: path });
    bindMapTarget(outline, id);
    map.append(outline);
  }
  for (const { item, x, y } of points) {
    const sourceMap = String(item.location.mapId);
    const marker = svgElement("g", { transform: `translate(${x * 150} ${y * 100})` });
    marker.append(svgElement("circle", { class: "map-marker-target", r: 2 }));
    marker.append(item.type === "death"
      ? svgElement("path", { class: "map-death", d: "M-1.25,-1.25l2.5,2.5m0,-2.5l-2.5,2.5" })
      : svgElement("circle", { class: "map-dot", r: 0.9 }));
    const title = svgElement("title", {});
    const { x: localX, y: localY, at } = item.location;
    title.textContent = `${eventLabel(item)} · ${mapNames.get(sourceMap)} · ${date(item.at)} · ${(localX * 100).toFixed(1)}, ${(localY * 100).toFixed(1)} · position ${item.at - at}s avant l’événement`;
    marker.append(title);
    if (sourceMap !== mapId) {
      marker.classList.add("map-marker-link");
      marker.addEventListener("click", () => zoomTo(sourceMap));
    }
    map.append(marker);
  }
}
const openImport = () => {
  $("#import-error").textContent = "";
  $("#import-dialog").showModal();
};
$("#open-import").addEventListener("click", openImport);
$("#empty-import").addEventListener("click", openImport);
$("#close-import").addEventListener("click", () => $("#import-dialog").close());
$("#search").addEventListener("input", renderRoster);
$("#map-filter").addEventListener("change", () => {
  selectMap($("#map-filter").value);
});
$("#map-zoom-out").addEventListener("click", () => {
  zoomTo(mapRegions.get(selectedMap)?.parent ?? AZEROTH);
});
$("#zones").addEventListener("click", (event) => {
  const button = event.target.closest("[data-map]");
  if (button) selectMap(button.dataset.map);
});
$("#import-file").addEventListener("change", async () => {
  try {
    const file = $("#import-file").files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024)
      throw new Error("Fichier trop volumineux (2 Mio maximum).");
    $("#payload").value = await file.text();
  } catch (error) {
    $("#import-error").textContent = error.message;
  }
});
$("#import-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#submit-import").disabled = true;
  $("#import-error").textContent = "";
  try {
    const payload = $("#payload").value;
    if (new TextEncoder().encode(payload).byteLength > 2 * 1024 * 1024)
      throw new Error("Export trop volumineux (2 Mio maximum).");
    JSON.parse(payload);
    const response = await fetch(API_PATH + "/import", {
      method: "POST",
      headers: { "Content-Type": IMPORT_TYPE },
      body: payload,
    });
    if (response.status === 401)
      throw new Error("Connectez-vous à ChaOS pour importer un relevé.");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    await load();
    $("#status").textContent =
      `${result.character} · ${result.added} nouveaux relevés ou événements enregistrés.`;
    $("#payload").value = "";
    $("#import-dialog").close();
  } catch (error) {
    $("#import-error").textContent = error.message;
  } finally {
    $("#submit-import").disabled = false;
  }
});
load().catch((error) => {
  $("#status").textContent = error.message;
});
