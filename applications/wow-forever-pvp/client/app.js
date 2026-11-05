import { groupZones, honorProgress, itemQuality, summarize } from "./model.js";
import { mountArmory } from "./armory.js";
import { AZEROTH, mapContains, mapRegions, projectPosition } from "./map-regions.js";

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
const qualities = ["Médiocre", "Commun", "Inhabituel", "Rare", "Épique", "Légendaire", "Artefact", "Héritage", "Jeton"];

function equipmentRow(item) {
  const quality = itemQuality(item);
  const name = item.link?.match(/\[([^\]]+)\]/u)?.[1] ?? `Objet #${item.itemId}`;
  const icon = Number.isSafeInteger(item.icon) && item.icon > 0
    ? `<img src="https://zephras.com/icons/card/${item.icon}.jpg" alt="" width="42" height="42" referrerpolicy="no-referrer">`
    : "";
  return `<li class="item" data-quality="${quality}">
    <span class="item-icon" aria-hidden="true"><span>◇</span>${icon}</span>
    <div class="item-info">
      <span class="item-slot">${slots[item.slot]}</span>
      <strong>${escape(name)}</strong>
      ${qualities[quality] ? `<span class="item-quality">${qualities[quality]}</span>` : ""}
    </div>
  </li>`;
}
let state = { characters: [] };
let selectedKey = null;
let selectedMap = AZEROTH;
let selectedEvents = [];
let mapNames = new Map();
let honorScope = "character";

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
function render() {
  renderRoster();
  const character = state.characters.find((item) => item.key === selectedKey);
  if (!character) return;
  const summary = summarize(character);
  const latest = summary.latest;
  $("#profile").innerHTML =
    `<div class="identity"><div><p class="eyebrow">${escape(character.faction ?? "FACTION INCONNUE")} / ${escape(character.realm)}</p><h2>${escape(character.name)}</h2><p>${escape(character.race ?? "Race inconnue")} · ${escape(character.class ?? "Classe inconnue")} · Niveau ${count(character.level)}</p><p>${escape(latest?.guild ?? "Guilde non relevée")} · Règles : ${escape(character.ruleset === "unknown" ? "Non renseignées" : character.ruleset)}</p></div><span class="sigil" aria-hidden="true">⚔</span></div>
    <div class="metrics"><div class="metric"><strong>${count(summary.lifetimeHK)}</strong><span>VH cumulées · tous contextes</span></div><div class="metric"><strong>${count(summary.worldHK)}</strong><span>VH observées · monde ouvert</span></div><div class="metric"><strong>${count(summary.deaths)}</strong><span>Morts observées · monde ouvert</span></div><div class="metric"><strong>${summary.delta == null ? "—" : "+" + count(summary.delta)}</strong><span>Écart du compteur · tous contextes</span></div></div>
    <p class="muted">Compteur relevé le ${escape(date(summary.counterAt))}. Dernier import : ${escape(date(character.lastImportedAt))}. Historique limité aux sessions collectées ; relevés auto-déclarés.</p>
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
    <div class="armory-layout">
      <section class="armory" aria-labelledby="armory-title">
        <div class="armory-heading">
          <h3 id="armory-title">Portrait du combattant</h3>
          <span class="badge">3D · 360°</span>
        </div>
        <div class="armory-stage">
          <div class="armory-placeholder">
            <span aria-hidden="true">⚔</span>
            <p>Le personnage et l’équipement du dernier relevé.</p>
          </div>
        </div>
        <p class="armory-appearance" hidden></p>
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
        <p class="muted">Glissez pour tourner. Molette ou pincement pour zoomer. Le vestiaire externe reçoit la race, la silhouette et les identifiants des objets.</p>
        <p class="muted">Les pièces disponibles dans le vestiaire s’affichent avec leurs textures du jeu. Le visage et les couleurs du personnage suivent le modèle par défaut.</p>
        <a class="armory-link" target="_blank" rel="noopener noreferrer" hidden>Ouvrir le modèle dans un nouvel onglet ↗</a>
      </section>
      <section class="arsenal" aria-labelledby="equipment-title">
        <div class="arsenal-heading">
          <div><p class="eyebrow">ARSENAL</p><h3 id="equipment-title">Équipement</h3></div>
          <span class="badge">${count(latest?.equipment.length ?? 0)} / 19</span>
        </div>
        <p class="muted arsenal-date">Relevé · ${escape(date(latest?.at))}</p>
        ${latest?.equipment.length
          ? `<ul class="equipment">${latest.equipment.map(equipmentRow).join("")}</ul>`
          : '<p class="muted">Aucun équipement lisible dans ce relevé.</p>'}
      </section>
    </div>`;
  mountArmory($(".armory"), character, latest);
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
  $("#activity").hidden = false;
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
function renderMap(events) {
  const map = $("#map");
  map.replaceChildren();
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
  const children = [...mapRegions]
    .filter(([, region]) => region.parent === mapId && region.bounds)
    .map(([id, region]) => {
      const [left, top, right, bottom] = region.hit ?? region.bounds;
      return { id, left, top, width: right - left, height: bottom - top };
    })
    .sort((a, b) => b.width * b.height - a.width * a.height);
  const positioned = events.filter((event) => event.location?.x != null);
  const points = positioned.flatMap((item) => {
    const position = projectPosition(item.location, mapId);
    return position ? [{ item, ...position }] : [];
  });
  const description = [
    children.length ? "Cliquez sur une région ou sur un marqueur pour zoomer." : "",
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

  for (const { id, left, top, width, height } of children) {
    const regionName = mapNames.get(id);
    const rect = svgElement("rect", {
      class: "map-region", x: left * 150, y: top * 100, width: width * 150, height: height * 100,
      tabindex: "0", role: "button", "aria-label": `Zoomer sur ${regionName}`,
    });
    const title = svgElement("title", {});
    title.textContent = regionName;
    rect.append(title);
    rect.addEventListener("click", () => zoomTo(id));
    rect.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      zoomTo(id);
    });
    map.append(rect);
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
