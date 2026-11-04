export function summarize(character) {
  const latest = character.snapshots.at(-1);
  const first = character.snapshots.find((item) => item.lifetimeHK != null);
  const lastKnown = character.snapshots.findLast(
    (item) => item.lifetimeHK != null,
  );
  const world = character.events.filter((item) => item.context === "world");
  return {
    latest,
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
