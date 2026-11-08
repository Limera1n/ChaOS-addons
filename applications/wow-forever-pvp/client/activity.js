import { identityScope } from "./identity.js";

export function dayKey(at) {
  const date = new Date(at * 1000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function dayBounds(day) {
  const start = new Date(`${day}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.getTime() / 1000, end: end.getTime() / 1000 - 1 };
}

export const filterDay = (events, day = "") => day ? events.filter((item) => dayKey(item.at) === day) : events;
export const activityCharacter = (character, day) => ({ ...character, events: filterDay(character.events, day) });

export function sortActivity(events, order = "newest") {
  return [...events].sort((a, b) => order === "oldest" ? a.at - b.at
    : order === "honor" ? (b.type === "honor-gain" ? b.amount : 0) - (a.type === "honor-gain" ? a.amount : 0) || b.at - a.at
    : b.at - a.at);
}

export function dailyActivity(events, order = "newest") {
  const days = new Map();
  for (const event of events) {
    if (event.context !== "world" || !["honor-gain", "player-kill", "death"].includes(event.type)) continue;
    const day = dayKey(event.at);
    const row = days.get(day) ?? { day, hk: 0, kills: 0, deaths: 0 };
    if (event.type === "honor-gain") row.hk += event.amount;
    if (event.type === "player-kill") row.kills++;
    if (event.type === "death") row.deaths++;
    days.set(day, row);
  }
  return [...days.values()].sort((a, b) => order === "oldest" ? a.day.localeCompare(b.day)
    : order === "honor" ? b.hk - a.hk || b.day.localeCompare(a.day) : b.day.localeCompare(a.day));
}

export function guildEvents(character, guild) {
  let next = 0;
  return character.events.filter((event) => {
    while (next < character.snapshots.length && character.snapshots[next].at <= event.at) next++;
    return character.snapshots[next - 1]?.guild === guild;
  });
}

// These are proximity observations, never evidence of actual party membership.
// Short encounters establish proximity. Repeated encounters with two shared
// participants form a session with no duration cap, including across zones.
export function probableGroups(characters, { day = "", windowSeconds = 120, radius = 0.03, inactivitySeconds = 1800 } = {}) {
  const observations = [];
  for (const character of characters) {
    let next = 0;
    for (const event of character.events) {
      while (next < character.snapshots.length && character.snapshots[next].at <= event.at) next++;
      const guild = character.snapshots[next - 1]?.guild;
      const position = event.location;
      if (!guild || event.context !== "world" || !["honor-gain", "player-kill"].includes(event.type)
        || !Number.isFinite(position?.x) || !Number.isFinite(position?.y)
        || position.x < 0 || position.x > 1 || position.y < 0 || position.y > 1
        || (day && dayKey(event.at) !== day)) continue;
      observations.push({ character, event, guild, scope: JSON.stringify([...identityScope(character), guild, position.mapId, dayKey(event.at)]) });
    }
  }
  observations.sort((a, b) => a.event.at - b.event.at || a.character.key.localeCompare(b.character.key));
  const cells = new Map();
  const clusters = [];
  for (const observation of observations) {
    const { event, scope } = observation;
    const { x, y } = event.location;
    const cx = Math.floor(x / radius), cy = Math.floor(y / radius);
    let cluster;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const cell = `${scope}/${cx + dx}/${cy + dy}`;
      const candidates = (cells.get(cell) ?? []).filter((item) => event.at - item.start <= windowSeconds);
      cells.set(cell, candidates);
      for (const item of candidates) {
        if (Math.hypot(Math.max(item.maxX, x) - Math.min(item.minX, x), Math.max(item.maxY, y) - Math.min(item.minY, y)) > radius) continue;
        if (!cluster || item.end > cluster.end) cluster = item;
      }
    }
    if (!cluster) {
      cluster = { start: event.at, end: event.at, guild: observation.guild, guildKey: JSON.stringify([...identityScope(observation.character), observation.guild]), scope, mapId: event.location.mapId,
        zone: event.location.zone ?? "Zone inconnue", x, y, minX: x, maxX: x, minY: y, maxY: y,
        members: new Map(), hk: 0, kills: 0, observations: 0 };
      const cell = `${scope}/${cx}/${cy}`;
      const entries = cells.get(cell) ?? [];
      entries.push(cluster);
      cells.set(cell, entries);
      clusters.push(cluster);
    }
    cluster.end = event.at;
    cluster.minX = Math.min(cluster.minX, x); cluster.maxX = Math.max(cluster.maxX, x);
    cluster.minY = Math.min(cluster.minY, y); cluster.maxY = Math.max(cluster.maxY, y);
    cluster.members.set(observation.character.key, { key: observation.character.key, name: observation.character.name });
    if (event.type === "honor-gain") cluster.hk += event.amount;
    else cluster.kills++;
    cluster.observations++;
  }
  const encounters = clusters.filter((item) => item.members.size >= 2).map(({ members, ...item }) => ({ ...item,
    x: (item.minX + item.maxX) / 2, y: (item.minY + item.maxY) / 2, members: [...members.values()] }))
    .sort((a, b) => a.start - b.start);
  const sessions = [];
  const active = new Map();
  for (const encounter of encounters) {
    const candidates = (active.get(encounter.guildKey) ?? []).filter((session) => encounter.start - session.last.end <= inactivitySeconds);
    let match;
    let bestOverlap = 1;
    for (const session of candidates) {
      const keys = new Set(session.last.members.map((member) => member.key));
      const overlap = encounter.members.filter((member) => keys.has(member.key)).length;
      if (overlap > bestOverlap || (overlap === bestOverlap && match && session.last.end > match.last.end)) {
        match = session;
        bestOverlap = overlap;
      }
    }
    if (!match) {
      match = { encounters: [], last: encounter };
      candidates.push(match);
      sessions.push(match);
    }
    match.encounters.push(encounter);
    if (encounter.end >= match.last.end) match.last = encounter;
    active.set(encounter.guildKey, candidates);
  }
  return sessions.map((session) => summarizeGroupSession(session.encounters)).sort((a, b) => b.end - a.end);
}

function summarizeGroupSession(encounters, original = null) {
  const first = encounters[0];
  const last = encounters.reduce((latest, item) => item.end > latest.end ? item : latest, first);
  const members = new Map();
  const zones = new Map();
  let hk = 0, kills = 0, observations = 0;
  for (const encounter of encounters) {
    for (const member of encounter.members) members.set(member.key, member);
    zones.set(encounter.mapId, encounter.zone);
    hk += encounter.hk; kills += encounter.kills; observations += encounter.observations;
  }
  return { ...last, start: first.start, end: last.end,
    sessionStart: original?.sessionStart ?? first.start, sessionEnd: original?.sessionEnd ?? last.end,
    members: [...members.values()], zones: [...zones.values()], hk, kills, observations, encounters };
}

// Filtering a multi-zone, multi-day session must also filter its credited VH,
// participants and markers, rather than attributing the whole outing to a day.
export function selectGroupSessions(sessions, { day = "", includesMap = () => true } = {}) {
  return sessions.flatMap((session) => {
    const encounters = session.encounters.filter((item) => (!day || dayKey(item.start) === day) && includesMap(item.mapId));
    return encounters.length ? [summarizeGroupSession(encounters, session)] : [];
  }).sort((a, b) => b.end - a.end);
}

export function formatSessionDuration(seconds) {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  if (!minutes) return "moins d’une minute";
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ""}` : `${minutes} min`;
}
