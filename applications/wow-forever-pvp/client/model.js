export function summarize(character) {
  const latest = character.snapshots.at(-1);
  const first = character.snapshots.find((item) => item.lifetimeHK != null);
  const lastKnown = character.snapshots.findLast(
    (item) => item.lifetimeHK != null,
  );
  const world = character.events.filter((item) => item.context === "world");
  const lastHonor = character.snapshots.findLast((item) => item.honorPoints != null);
  const honorEvents = character.events.filter((item) =>
    item.type === "honor-points-gain" || item.type === "honor-points-loss");
  const honorKnown = lastHonor != null || honorEvents.length > 0;
  return {
    latest,
    honorPoints: lastHonor?.honorPoints ?? null,
    honorAt: lastHonor?.at ?? null,
    honorGained: honorKnown ? honorEvents.reduce((sum, item) => sum + (item.type === "honor-points-gain" ? item.amount : 0), 0) : null,
    honorLost: honorKnown ? honorEvents.reduce((sum, item) => sum + (item.type === "honor-points-loss" ? item.amount : 0), 0) : null,
    worldHonor: honorKnown ? honorEvents.reduce((sum, item) => sum + (item.type === "honor-points-gain" && item.context === "world" ? item.amount : 0), 0) : null,
    honorEvents,
    lifetimeHK: lastKnown?.lifetimeHK ?? null,
    counterAt: lastKnown?.at ?? null,
    delta:
      first &&
      lastKnown &&
      first !== lastKnown &&
      lastKnown.lifetimeHK >= first.lifetimeHK &&
      !character.events.some(
        (item) =>
          item.type === "counter-reset" &&
          item.at >= first.at &&
          item.at <= lastKnown.at,
      )
        ? lastKnown.lifetimeHK - first.lifetimeHK
        : null,
    worldHK: world.reduce(
      (sum, item) => sum + (item.type === "honor-gain" ? item.amount : 0),
      0,
    ),
    deaths: world.filter((item) => item.type === "death").length,
    events: world.filter(
      (item) => item.type === "honor-gain" || item.type === "death",
    ),
  };
}

export function filterDeaths(events, cause = "all") {
  return events.filter((item) => item.type !== "death" || cause === "all" || (item.cause ?? "unknown") === cause);
}

export function groupZones(events) {
  const zones = new Map();
  for (const event of events) {
    const key = event.location?.mapId ?? "unknown";
    const zone = zones.get(key) ?? {
      key,
      name: event.location?.zone ?? "Zone inconnue",
      hk: 0,
      deaths: 0,
    };
    if (event.type === "honor-gain") zone.hk += event.amount;
    if (event.type === "death") zone.deaths++;
    zones.set(key, zone);
  }
  return [...zones.values()].sort((a, b) => b.hk - a.hk || b.deaths - a.deaths);
}

export function honorProgress(characters, guild = null) {
  const gains = new Map();
  let start = Infinity;
  let end = -Infinity;
  function observe(at) {
    start = Math.min(start, at);
    end = Math.max(end, at);
  }
  for (const { snapshots, events } of characters) {
    for (const snapshot of snapshots) {
      if (guild === null || snapshot.guild === guild) observe(snapshot.at);
    }
    // The store sorts observations by time. Attribute each gain to the last
    // guild reported at that time, including for characters who since left.
    let next = 0;
    for (const event of events) {
      if (guild !== null) {
        while (next < snapshots.length && snapshots[next].at <= event.at) next++;
        if (snapshots[next - 1]?.guild !== guild) continue;
      }
      observe(event.at);
      if (event.type === "honor-gain" && event.context === "world")
        gains.set(event.at, (gains.get(event.at) ?? 0) + event.amount);
    }
  }
  if (start === Infinity) return null;
  let total = 0;
  const points = [...gains].sort(([a], [b]) => a - b).map(([at, amount]) => {
    total += amount;
    return { at, total };
  });
  return { start, end, points, total };
}

const linkColors = ["9d9d9d", "ffffff", "1eff00", "0070dd", "a335ee", "ff8000", "e6cc80", "00ccff", "00ccff"];

export function itemQuality(item) {
  if (item.quality != null) return item.quality;
  const qualityToken = item.link?.match(/^\|cnIQ([0-8]):/u);
  if (qualityToken) return Number(qualityToken[1]);
  const rgb = item.link?.match(/^\|cff([\da-f]{6})/iu)?.[1].toLowerCase();
  return linkColors.indexOf(rgb);
}
