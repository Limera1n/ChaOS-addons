import { filterDeaths, formatPlayed, groupZones, guildKey, honorProgress, itemQuality, killLabel, listGuilds, summarize, summarizeGuild } from "./model.js";
import { itemEnchant, mountArmory } from "./armory.js";
import { AZEROTH, mapContains, mapRegions, projectPosition } from "./map-regions.js";
import { mapOutlines } from "./map-outlines.js";
import { bindEquipmentTooltips, hideEquipmentTooltip } from "./item-tooltips.js";
import { installDesktopCursor } from "./desktop-cursor.js";
import { canonicalLinkKey, scopeLabel } from "./identity.js";
import { activityCharacter, dailyActivity, dayBounds, dayKey, filterDay, guildEvents, probableGroups, sortActivity } from "./activity.js";

installDesktopCursor();

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
  if (item.type === "player-kill") return killLabel(item);
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
let directory = "players";
let selectedGuild = null;
let profileView = "pvp";
let selectedDay = "";
let activityOrder = "newest";
let activityEvents = [];
let allGroups = [];
let visibleGroups = [];
let mountCurrentArmory = null;
const dayLabel = (day) => new Date(`${day}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const scopedCharacter = (character) => activityCharacter(character, selectedDay);

function renderPeriod() {
  const days = [...new Set(state.characters.flatMap((character) => [...character.events, ...character.snapshots].map((item) => dayKey(item.at))))].sort().reverse();
  const picker = $("#day-filter");
  picker.replaceChildren(new Option("Toute la période", ""));
  for (const day of days) picker.add(new Option(dayLabel(day), day));
  if (selectedDay && !days.includes(selectedDay)) selectedDay = "";
  picker.value = selectedDay;
  $("#period-label").textContent = selectedDay ? dayLabel(selectedDay) : "Toute la période";
}

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
  if (view === "character") mountCurrentArmory?.();
}

function renderHonorProgress(character, guildSummary = null, guildName = null) {
  const panel = $(".honor-progress");
  const isGuild = guildSummary !== null;
  const scope = isGuild ? "guild" : "character";
  panel.dataset.scope = scope;
  const rawHistory = isGuild ? guildSummary.history : honorProgress([scopedCharacter(character)]);
  const history = rawHistory && selectedDay ? { ...rawHistory, ...dayBounds(selectedDay) } : rawHistory;
  panel.querySelector(".honor-scope").textContent = isGuild ? guildName : character.name;
  panel.querySelector(".honor-total").textContent = history ? `${count(history.total)} VH` : "—";
  panel.querySelector(".honor-note").textContent = history?.total === 0
    ? "Aucune VH observée sur cette période."
    : isGuild
      ? "Gains cumulés de tous les membres suivis, tous contextes, pendant leur appartenance à la guilde."
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
  panel.querySelector(".honor-chart").setAttribute("aria-label", `${count(total)} VH observées · ${isGuild ? guildName : character.name}`);
}

async function load() {
  const response = await fetch(API_PATH + "/state");
  if (!response.ok) throw new Error("Impossible de charger les relevés.");
  state = await response.json();
  allGroups = probableGroups(state.characters);
  if (!state.characters.some((item) => item.key === selectedKey))
    selectedKey = state.characters[0]?.key ?? null;
  readRoute();
}
function renderRoster() {
  for (const button of document.querySelectorAll("[data-directory]"))
    button.setAttribute("aria-pressed", String(button.dataset.directory === directory));
  $("#directory-title").textContent = directory === "guilds" ? "Les guildes" : "Les joueurs";
  const query = $("#search").value.toLocaleLowerCase("fr");
  if (directory === "guilds") {
    const guilds = listGuilds(state.characters);
    $("#roster-count").textContent = guilds.length;
    $("#roster").replaceChildren();
    for (const guild of guilds.filter((item) => `${item.name} ${scopeLabel(item)}`.toLocaleLowerCase("fr").includes(query))) {
      const button = document.createElement("button");
      button.className = "roster-item";
      button.setAttribute("aria-pressed", String(guild.key === selectedGuild));
      const summary = summarizeGuild(state.characters, guild);
      button.innerHTML = `${escape(guild.name)}<small>${escape(scopeLabel(guild))} · ${count(summary.currentMembers)} membre(s) suivi(s)</small>`;
      button.addEventListener("click", () => navigate("guilds", guild.key));
      $("#roster").append(button);
    }
    if (!guilds.length) $("#roster").textContent = "Aucune guilde dans les relevés importés.";
    return;
  }
  const roster = state.characters.filter((item) =>
    `${item.name} ${summarize(item).latest?.guild ?? ""}`
      .toLocaleLowerCase("fr")
      .includes(query),
  );
  $("#roster-count").textContent = state.characters.length;
  $("#roster").replaceChildren();
  for (const character of roster.sort(
    (a, b) => summarize(scopedCharacter(b)).worldHK - summarize(scopedCharacter(a)).worldHK,
  )) {
    const button = document.createElement("button");
    button.className = "roster-item";
    button.setAttribute("aria-pressed", String(character.key === selectedKey));
    button.innerHTML = `${escape(character.name)}<small>${escape(character.class ?? "Classe inconnue")} · ${count(summarize(scopedCharacter(character)).worldHK)} VH sur la période</small>`;
    button.addEventListener("click", () => {
      if (selectedKey === character.key) return;
      selectedMap = AZEROTH;
      navigate("players", character.key);
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

function progressChart(guild = false) {
  return `<section class="honor-progress" aria-labelledby="honor-title">
    <div class="honor-heading"><div><p class="eyebrow">${guild ? "EFFORT COLLECTIF · TOUS CONTEXTES" : "MONDE OUVERT"}</p><h3 id="honor-title">Évolution des VH${guild ? " de la guilde" : ""}</h3></div></div>
    <div class="honor-reading"><span class="honor-scope"></span><strong class="honor-total"></strong></div>
    <div class="honor-plot">
      <svg class="honor-chart" viewBox="0 0 560 100" preserveAspectRatio="none" role="img">
        <defs><linearGradient id="honor-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".25"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
        <path class="honor-grid" d="M 8 12 H 552 M 8 50 H 552 M 8 88 H 552"/>
        <path class="honor-area" fill="url(#honor-fill)"/><path class="honor-line"/>
      </svg>
      <div class="honor-dates"><span class="honor-start"></span><span class="honor-end"></span></div>
    </div>
    <p class="muted honor-note"></p>
  </section>`;
}

function renderGuild() {
  $("#activity").hidden = false;
  const guilds = listGuilds(state.characters);
  const guild = guilds.find((item) => item.key === selectedGuild) ?? guilds[0];
  if (!guild) {
    $("#activity").hidden = true;
    $("#profile").innerHTML = '<div class="empty"><p class="eyebrow">LES GUILDES</p><h2>Aucune guilde relevée.</h2><p>Importe les exports des membres pour ouvrir la fiche de leur guilde.</p></div>';
    return;
  }
  selectedGuild = guild.key;
  renderRoster();
  const summary = summarizeGuild(state.characters.map(scopedCharacter), guild);
  $("#profile").innerHTML = `<section class="guild-page" aria-labelledby="guild-title">
    <div class="guild-heading"><div><p class="eyebrow">CARNET DE GUILDE</p><h2 id="guild-title">&lt;${escape(guild.name)}&gt;</h2><p class="muted">${escape(scopeLabel(guild))}</p></div><span class="guild-banner" aria-hidden="true">⚑</span></div>
    <div class="metrics">
      <div class="metric"><strong>${count(summary.lifetimeHK)}</strong><span>VH cumulées · membres actuels suivis</span></div>
      <div class="metric"><strong>${count(summary.history?.total ?? 0)}</strong><span>VH gagnées en guilde · observées</span></div>
      <div class="metric"><strong>${count(summary.worldHistory?.total ?? 0)}</strong><span>Dont monde ouvert</span></div>
      <div class="metric"><strong>${count(summary.currentMembers)}</strong><span>Membres actuels suivis</span></div>
    </div>
    <p class="muted">Les VH cumulées additionnent les derniers compteurs connus de ${count(summary.knownCounters)} membre(s) actuel(s), y compris leurs VH acquises avant la guilde. La courbe additionne uniquement les gains observés pendant l’appartenance à cette guilde, anciens membres compris.</p>
    ${summary.members.length === 1 ? '<p class="notice">Un seul personnage suivi : la courbe de guilde contient uniquement ses gains. Importe les relevés des autres membres pour les ajouter.</p>' : ""}
    ${progressChart(true)}
    <div class="section-title"><h3>Contributions des membres</h3><span>${count(summary.members.length)} personnage(s) suivi(s)</span></div>
    <div class="table-scroll"><table class="guild-members"><thead><tr><th>Personnage</th><th>Statut relevé</th><th>VH cumulées</th><th>Gains en guilde</th><th>Dont monde ouvert</th></tr></thead><tbody>
    ${summary.members.map((member) => `<tr><td><a href="#player=${encodeURIComponent(member.character.key)}">${escape(member.character.name)}</a><small>${escape(member.character.class ?? "Classe inconnue")}</small></td><td>${member.current ? "Membre" : "Ancien membre"}</td><td>${count(member.lifetimeHK)}</td><td>+${count(member.history.total)}</td><td>+${count(member.worldHistory.total)}</td></tr>`).join("")}
    </tbody></table></div>
    <p class="muted">Seuls les personnages dont les données ont été importées sont inclus. Les VH de groupe comptent pour chaque participant ; ce total représente les crédits de VH des membres, pas des victimes uniques. Les périodes sans collecte ne sont pas reconstituées.</p>
  </section>`;
  renderHonorProgress(null, summary, guild.name);
  const events = summary.members.flatMap(({ character }) => {
    const original = state.characters.find((item) => item.key === character.key);
    return guildEvents(original, guild.name).filter((item) => item.context === "world" && ["honor-gain", "death", "player-kill"].includes(item.type))
      .map((item) => ({ ...item, actor: original.name }));
  }).sort((a, b) => a.at - b.at);
  prepareActivity(events);
}

function navigate(view, key) {
  const hash = `#${view === "guilds" ? "guild" : "player"}=${encodeURIComponent(key)}`;
  if (location.hash === hash) readRoute();
  else location.hash = hash;
}

function readRoute() {
  const previousKey = selectedKey;
  const previousDirectory = directory;
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.has("guild")) {
    directory = "guilds";
    selectedGuild = canonicalLinkKey(params.get("guild"));
  } else if (params.has("player")) {
    directory = "players";
    selectedKey = canonicalLinkKey(params.get("player"), "player");
  } else directory = "players";
  if (!state.characters.some((item) => item.key === selectedKey))
    selectedKey = state.characters[0]?.key ?? null;
  if (directory === "players" && (selectedKey !== previousKey || previousDirectory !== "players")) profileView = "pvp";
  render();
}

function render() {
  hideEquipmentTooltip();
  renderPeriod();
  $("#profile").setAttribute("aria-label", directory === "guilds" ? "Fiche guilde" : "Fiche personnage");
  renderRoster();
  if (directory === "guilds") {
    renderGuild();
    return;
  }
  const character = state.characters.find((item) => item.key === selectedKey);
  if (!character) return;
  const summary = summarize(scopedCharacter(character));
  const latest = summary.latest;
  const guild = latest?.guild;
  $("#profile").innerHTML =
    `<section class="armory" aria-labelledby="armory-title">
    <img class="armory-backdrop" alt="" referrerpolicy="no-referrer" hidden>
    <div class="armory-heading">
    <div class="identity">
      <svg class="sigil" viewBox="0 0 96 100" role="img" aria-label="${escape(character.faction ?? "Faction inconnue")}">${factionMark(character.faction?.toLowerCase())}</svg>
      <div class="armory-identity-copy">
        <h2 id="armory-title">${escape(character.name)}</h2>
        <p class="armory-identity-meta">Niveau ${count(character.level)} · ${escape(character.race ?? "Race inconnue")} · ${escape(character.class ?? "Classe inconnue")}</p>
        <p class="armory-affiliation">${guild ? `<a class="guild-link" href="#guild=${encodeURIComponent(guildKey(character, guild))}">&lt;${escape(guild)}&gt;</a> · ` : ""}${escape(scopeLabel(character))}</p>
      </div>
    </div>
    <div class="armory-summary">
      <div class="played-badge" tabindex="0" title="${summary.playedAt == null ? "Temps de jeu non relevé" : `Relevé le ${escape(date(summary.playedAt))}`}"><span>Temps de jeu</span><strong>${summary.playedSeconds == null ? "—" : escape(formatPlayed(summary.playedSeconds))}</strong></div>
      <span class="armory-equipped">${count(latest?.equipment.length ?? 0)} / 19 pièces équipées</span>
    </div>
    </div>
    <nav class="armory-tabs" aria-label="Vues de la fiche">
      <button type="button" data-profile-view="pvp" aria-controls="armory-pvp activity">Joueur contre joueur</button>
      <button type="button" data-profile-view="character" aria-controls="armory-character">Personnage</button>
    </nav>
    ${armoryEquipment(latest)}
    <div id="armory-pvp" hidden>
    <section aria-labelledby="honor-points-title">
      <h3 id="honor-points-title">Points d’honneur</h3>
      <div class="metrics">
        <div class="metric"><strong>${count(summary.honorPoints)}</strong><span>Solde disponible</span></div>
        <div class="metric"><strong>${count(summary.honorGained)}</strong><span>Points gagnés · observés</span></div>
        <div class="metric"><strong>${count(summary.honorLost)}</strong><span>Baisses du solde · observées</span></div>
        <div class="metric"><strong>${count(summary.worldHonor)}</strong><span>Points gagnés · monde ouvert</span></div>
      </div>
      <p class="muted">${summary.honorAt == null ? "Solde non relevé : installe le collecteur 0.5.5 puis importe un nouvel export." : `Solde relevé le ${escape(date(summary.honorAt))}.`} Les variations observées incluent tous les contextes. Une baisse peut correspondre à un achat ou à une remise à zéro. Les variations hors ligne ne sont pas comptées.</p>
      <details><summary>Historique des points d’honneur</summary>
        <ul>${summary.honorEvents.length ? summary.honorEvents.slice(-20).reverse().map((item) => `<li>${escape(date(item.at))} · ${item.type === "honor-points-gain" ? "+" : "−"}${count(item.amount)} points · ${escape(({world: "monde ouvert", pvp: "champ de bataille", arena: "arène", instance: "instance", unknown: "contexte inconnu"})[item.context])}</li>`).join("") : "<li>Aucune variation observée.</li>"}</ul>
      </details>
    </section>
    <div class="metrics"><div class="metric"><strong>${count(summary.lifetimeHK)}</strong><span>VH cumulées · tous contextes</span></div><div class="metric"><strong>${count(summary.worldHK)}</strong><span>VH observées · monde ouvert</span></div><div class="metric"><strong>${count(summary.deaths)}</strong><span>Morts observées · monde ouvert</span></div><div class="metric"><strong>${summary.delta == null ? "—" : "+" + count(summary.delta)}</strong><span>Écart du compteur · tous contextes</span></div></div>
    <p class="muted">Compteur relevé le ${escape(date(summary.counterAt))}. Dernier import le ${escape(date(character.lastImportedAt))}. ${escape(scopeLabel(character))}. ${count(summary.kills)} coup${summary.kills === 1 ? "" : "s"} fatal${summary.kills === 1 ? "" : "s"} observé${summary.kills === 1 ? "" : "s"} en monde ouvert (toi ou ton familier).</p>
    ${progressChart()}
    </div>
    </section>`;
  let mounted = false;
  mountCurrentArmory = () => {
    if (mounted) return;
    mounted = true;
    mountArmory($(".armory"), character, latest);
  };
  bindEquipmentTooltips($("#profile"), latest?.equipment ?? []);
  for (const button of $(".armory").querySelectorAll("[data-profile-view]")) {
    button.addEventListener("click", () => setProfileView(button.dataset.profileView));
  }
  renderHonorProgress(character);
  for (const icon of $("#profile").querySelectorAll(".item-icon img"))
    icon.addEventListener("error", () => icon.remove(), { once: true });
  setProfileView(profileView);
  prepareActivity(summarize(character).events);
}

function prepareActivity(events) {
  activityEvents = events;
  selectedEvents = filterDay(events, selectedDay);
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
  selectMap(selectedMap);
}
function renderZones(events) {
  const zones = groupZones(events);
  $("#zones").innerHTML = zones.length
    ? zones
        .map(
          (zone) =>
            `<button type="button" class="zone" data-map="${escape(zone.key)}"><strong>${escape(zone.name)}</strong><span>${count(zone.hk)} VH · ${count(zone.kills)} joueur${zone.kills === 1 ? "" : "s"} tué${zone.kills === 1 ? "" : "s"} · ${count(zone.deaths)} mort${zone.deaths === 1 ? "" : "s"}</span></button>`,
        )
        .join("")
    : '<p class="muted">Aucun événement pour cette sélection.</p>';
}

function renderDailyActivity() {
  const events = filterDeaths(activityEvents, $("#death-filter").value).filter((item) =>
    selectedMap === AZEROTH || mapContains(selectedMap, String(item.location?.mapId ?? "unknown")));
  const days = dailyActivity(events, activityOrder);
  const max = Math.max(1, ...days.map((item) => item.hk));
  $("#daily-rows").innerHTML = days.length ? days.map((item) => `<button type="button" class="day-row" data-day="${item.day}" aria-pressed="${item.day === selectedDay}">
    <span class="day-date">${escape(dayLabel(item.day))}</span><svg class="day-meter" aria-hidden="true" viewBox="0 0 100 4" preserveAspectRatio="none"><rect class="day-track" width="100" height="4"/><rect class="day-bar" width="${Math.round(item.hk / max * 100)}" height="4"/></svg>
    <strong>${count(item.hk)} VH</strong><small>${count(item.kills)} coup(s) fatal(s) · ${count(item.deaths)} mort(s)</small></button>`).join("")
    : '<p class="muted">Aucune activité en monde ouvert sur cette carte.</p>';
}

function renderEncounters() {
  visibleGroups = allGroups.filter((group) =>
    (directory === "guilds" ? group.guildKey === selectedGuild : group.members.some((member) => member.key === selectedKey))
    && (!selectedDay || dayKey(group.start) === selectedDay)
    && (selectedMap === AZEROTH || mapContains(selectedMap, String(group.mapId))));
  $("#encounters-count").textContent = `${count(visibleGroups.length)} séquence(s)${visibleGroups.length > 12 ? " · 12 plus récentes affichées" : ""}`;
  $("#encounters").innerHTML = visibleGroups.length ? visibleGroups.slice(0, 12).map((group, index) => `<article class="encounter-card">
    <div class="encounter-heading"><span class="encounter-tag">Groupe probable</span><time>${escape(date(group.start))}</time></div>
    <h4>${escape(group.zone)}</h4><p class="encounter-reading"><strong>${count(group.members.length)} membres</strong><span>+${count(group.hk)} VH créditées · ${count(group.kills)} coup(s) fatal(s)</span></p>
    <p class="encounter-members">${group.members.map((member) => `<a href="#player=${encodeURIComponent(member.key)}">${escape(member.name)}</a>`).join(" · ")}</p>
    <div class="encounter-footer"><small>${Math.max(1, group.end - group.start)} s · ${count(group.observations)} observation(s)</small><button type="button" data-encounter="${index}">Voir sur la carte ↗</button></div>
    </article>`).join("") : '<p class="muted encounter-empty">Aucun groupe probable sur cette sélection. Deux membres avec des positions proches sont nécessaires ; importer leurs relevés permet de les rapprocher.</p>';
}
function selectMap(mapId) {
  selectedMap = mapId;
  $("#map-filter").value = mapId;
  const filtered = filterDeaths(selectedEvents, $("#death-filter").value);
  renderZones(filtered);
  for (const button of $("#zones").querySelectorAll("[data-map]"))
    button.setAttribute("aria-pressed", String(button.dataset.map === mapId));
  const events = filtered.filter(
    (item) =>
      mapId === AZEROTH ||
      mapContains(mapId, String(item.location?.mapId ?? "unknown")),
  );
  renderDailyActivity();
  renderEncounters();
  renderEvents(events);
  renderMap(events);
}
function renderEvents(events) {
  $("#events").innerHTML =
    sortActivity(events, activityOrder)
      .slice(0, 200)
      .map((item) => {
        const location = item.location;
        const position =
          location?.x == null
            ? "Indisponible"
            : `${(location.x * 100).toFixed(1)}, ${(location.y * 100).toFixed(1)} · ${item.at - location.at}s avant`;
        return `<tr><td>${escape(date(item.at))}</td><td>${item.actor ? `<b>${escape(item.actor)}</b> · ` : ""}${escape(eventLabel(item))}</td><td>${escape(location?.zone ?? "Zone inconnue")}</td><td>${escape(position)}</td></tr>`;
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
  // SVG paints in DOM order: honor markers must sit above every death cross.
  const ordered = [...points].sort((a, b) => Number(a.item.type !== "death") - Number(b.item.type !== "death"));
  for (const { item, x, y } of ordered) {
    const sourceMap = String(item.location.mapId);
    const marker = svgElement("g", { transform: `translate(${x * 150} ${y * 100})` });
    marker.append(svgElement("circle", { class: "map-marker-target", r: 2 }));
    marker.append(item.type === "death"
      ? svgElement("path", { class: "map-death", d: "M-1.25,-1.25l2.5,2.5m0,-2.5l-2.5,2.5" })
      : item.type === "player-kill"
      ? svgElement("path", { class: "map-dot", d: "M0,-1.4L1.1,0 0,1.4 -1.1,0Z" })
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
  for (const group of visibleGroups) {
    const position = projectPosition({ mapId: group.mapId, x: group.x, y: group.y }, mapId);
    if (!position) continue;
    const ring = svgElement("circle", { class: "map-group", cx: position.x * 150, cy: position.y * 100, r: 2.2 });
    const title = svgElement("title", {});
    title.textContent = `Groupe probable · ${group.members.map((member) => member.name).join(", ")} · ${date(group.start)}`;
    ring.append(title);
    map.append(ring);
  }
}
const openImport = () => {
  $("#import-error").textContent = "";
  $("#import-dialog").showModal();
};
$("#death-filter").addEventListener("change", () => selectMap(selectedMap));
$("#day-filter").addEventListener("change", () => {
  selectedDay = $("#day-filter").value;
  render();
});
$("#event-sort").addEventListener("change", () => {
  activityOrder = $("#event-sort").value;
  selectMap(selectedMap);
});
$("#daily-rows").addEventListener("click", (event) => {
  const button = event.target.closest("[data-day]");
  if (!button) return;
  selectedDay = selectedDay === button.dataset.day ? "" : button.dataset.day;
  render();
});
$("#encounters").addEventListener("click", (event) => {
  const button = event.target.closest("[data-encounter]");
  if (!button) return;
  const group = visibleGroups[Number(button.dataset.encounter)];
  selectedMap = String(group.mapId);
  selectedDay = dayKey(group.start);
  if (directory === "players") profileView = "pvp";
  render();
  $("#map-current").scrollIntoView({ block: "center", behavior: "smooth" });
});
$("#open-import").addEventListener("click", openImport);
$("#empty-import").addEventListener("click", openImport);
$("#close-import").addEventListener("click", () => $("#import-dialog").close());
$("#search").addEventListener("input", renderRoster);
window.addEventListener("hashchange", readRoute);
for (const button of document.querySelectorAll("[data-directory]")) {
  button.addEventListener("click", () => {
    $("#search").value = "";
    const guilds = listGuilds(state.characters);
    if (button.dataset.directory === "guilds") {
      const key = selectedGuild ?? guilds[0]?.key;
      if (key) navigate("guilds", key);
      else { directory = "guilds"; render(); }
    } else if (selectedKey) navigate("players", selectedKey);
    else { directory = "players"; render(); }
  });
}
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
