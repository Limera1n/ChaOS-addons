// Lifetime HK cannot decrease. Legacy clients counted a transient zero's
// return as a fresh gain; retain the raw amount so old exports still dedupe.
export function repairCounterRebounds(character) {
  const sources = new Map();
  const observations = [...character.snapshots, ...character.events].sort((a, b) =>
    a.at - b.at || String(a.id).localeCompare(String(b.id), "en", { numeric: true }));
  for (const item of observations) {
    const source = sources.get(item.sourceId) ?? { counter: null, resetAt: null };
    sources.set(item.sourceId, source);
    if (Object.hasOwn(item, "lifetimeHK")) {
      if (item.lifetimeHK != null) source.counter = Math.max(source.counter ?? 0, item.lifetimeHK);
    } else if (item.type === "counter-reset") {
      source.resetAt = item.at;
    } else if (item.type === "session-start" || item.type === "session-end") {
      source.resetAt = null;
    } else if (item.type === "honor-gain") {
      if (item.counterReboundAmount != null) {
        source.resetAt = null;
        continue;
      }
      // Only repair an exact return to the independently reconstructed count,
      // immediately after a reset from the same installation and session.
      if (source.resetAt != null && item.at - source.resetAt <= 5 && item.amount > 0
          && item.amount === source.counter) {
        item.counterReboundAmount = item.amount;
        item.amount = 0;
      } else if (source.counter != null) source.counter += item.amount;
      source.resetAt = null;
    }
  }
}
