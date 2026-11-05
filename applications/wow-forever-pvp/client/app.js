import { groupZones, summarize } from "./model.js";

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
let state = { characters: [] };
let selectedKey = null;
let selectedMap = "all";
let selectedEvents = [];

async function load() {
  const response = await fetch(API_PATH + "/state");
  if (!response.ok) throw new Error("Impossible de charger les relevés.");
  state = await response.json();
  if (!state.characters.some((item) => item.key === selectedKey))
    selectedKey = state.characters[0]?.key ?? null;
  render();
}
function render() {
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
      selectedKey = character.key;
      selectedMap = "all";
      render();
    });
    $("#roster").append(button);
  }
  const character = state.characters.find((item) => item.key === selectedKey);
  if (!character) return;
  const summary = summarize(character);
  const latest = summary.latest;
  $("#profile").innerHTML =
    `<div class="identity"><div><p class="eyebrow">${escape(character.faction ?? "FACTION INCONNUE")} / ${escape(character.realm)}</p><h2>${escape(character.name)}</h2><p>${escape(character.race ?? "Race inconnue")} · ${escape(character.class ?? "Classe inconnue")} · Niveau ${count(character.level)}</p><p>${escape(latest?.guild ?? "Guilde non relevée")} · Règles : ${escape(character.ruleset === "unknown" ? "Non renseignées" : character.ruleset)}</p></div><span class="sigil" aria-hidden="true">⚔</span></div>
    <div class="metrics"><div class="metric"><strong>${count(summary.lifetimeHK)}</strong><span>VH cumulées · tous contextes</span></div><div class="metric"><strong>${count(summary.worldHK)}</strong><span>VH observées · monde ouvert</span></div><div class="metric"><strong>${count(summary.deaths)}</strong><span>Morts observées · cause inconnue</span></div><div class="metric"><strong>${summary.delta == null ? "—" : "+" + count(summary.delta)}</strong><span>Écart du compteur · tous contextes</span></div></div>
    <p class="muted">Compteur relevé le ${escape(date(summary.counterAt))}. Dernier import : ${escape(date(character.lastImportedAt))}. Historique limité aux sessions collectées ; relevés auto-déclarés.</p>
    <h3>Équipement <span class="muted">/ ${escape(date(latest?.at))}</span></h3><div class="equipment">${latest?.equipment.length ? latest.equipment.map((item) => `<div class="item"><small>${slots[item.slot]}</small>${escape(item.link?.match(/\[([^\]]+)\]/u)?.[1] ?? `Objet #${item.itemId}`)}</div>`).join("") : '<p class="muted">Aucun équipement lisible dans ce relevé.</p>'}</div><p class="muted">Portrait 3D et détails d’objets à venir.</p>`;
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
$("#search").addEventListener("input", render);
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
