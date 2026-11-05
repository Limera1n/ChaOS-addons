import { groupZones, honorProgress, itemQuality, summarize } from "./model.js";
import { mountArmory } from "./armory.js";

// Same paths as server/routes.js; the client cannot import server code.
const API_PATH = "/api/wow-forever-pvp";
const IMPORT_TYPE = "application/vnd.chaos-world-pvp+json";

const $ = (selector) => document.querySelector(selector);
const date = (at) =>
  at == null ? "Non relevé" : new Date(at * 1000).toLocaleString("fr-FR");
const count = (value) => (value == null ? "—" : value.toLocaleString("fr-FR"));
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
let selectedMap = "all";
let selectedEvents = [];
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
      selectedMap = "all";
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
    <div class="metrics"><div class="metric"><strong>${count(summary.lifetimeHK)}</strong><span>VH cumulées · tous contextes</span></div><div class="metric"><strong>${count(summary.worldHK)}</strong><span>VH observées · monde ouvert</span></div><div class="metric"><strong>${count(summary.deaths)}</strong><span>Morts observées · cause inconnue</span></div><div class="metric"><strong>${summary.delta == null ? "—" : "+" + count(summary.delta)}</strong><span>Écart du compteur · tous contextes</span></div></div>
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
  $("#map-filter").replaceChildren(new Option("Toutes les zones", "all"));
  for (const zone of zones)
    $("#map-filter").add(
      new Option(`${zone.name} · ${zone.key}`, String(zone.key)),
    );
  if (
    ![...$("#map-filter").options].some(
      (option) => option.value === selectedMap,
    )
  )
    selectedMap = "all";
  $("#map-filter").value = selectedMap;
  $("#zones").innerHTML = zones.length
    ? zones
        .map(
          (zone) =>
            `<div class="zone"><strong>${escape(zone.name)}</strong><span>${count(zone.hk)} VH · ${count(zone.deaths)} mort${zone.deaths === 1 ? "" : "s"}</span></div>`,
        )
        .join("")
    : '<p class="muted">Aucun événement en monde ouvert collecté.</p>';
  $("#activity").hidden = false;
  renderEvents();
}
function renderEvents() {
  const events = selectedEvents.filter(
    (item) =>
      selectedMap === "all" ||
      String(item.location?.mapId ?? "unknown") === selectedMap,
  );
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
        return `<tr><td>${escape(date(item.at))}</td><td>${item.type === "death" ? "Mort · cause inconnue" : `+${count(item.amount)} VH`}</td><td>${escape(location?.zone ?? "Zone inconnue")}</td><td>${escape(position)}</td></tr>`;
      })
      .join("") ||
    '<tr><td colspan="4">Aucun événement pour cette sélection.</td></tr>';
  const map = $("#map");
  map.replaceChildren();
  if (selectedMap === "all" || selectedMap === "unknown") return;
  for (const item of events.filter((event) => event.location?.x != null)) {
    const { x, y, at } = item.location;
    const element = document.createElementNS(
      "http://www.w3.org/2000/svg",
      item.type === "death" ? "path" : "circle",
    );
    if (item.type === "death") {
      element.setAttribute("d", `M${x * 100 - 1},${y * 100 - 1}l2,2m0,-2l-2,2`);
      element.setAttribute("class", "map-death");
    } else {
      element.setAttribute("cx", x * 100);
      element.setAttribute("cy", y * 100);
      element.setAttribute("r", "1");
      element.setAttribute("class", "map-dot");
    }
    const title = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "title",
    );
    title.textContent = `${item.type === "death" ? "Mort · cause inconnue" : `+${item.amount} VH`} · ${date(item.at)} · ${(x * 100).toFixed(1)}, ${(y * 100).toFixed(1)} · position ${item.at - at}s avant l’événement`;
    element.append(title);
    map.append(element);
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
  selectedMap = $("#map-filter").value;
  renderEvents();
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
