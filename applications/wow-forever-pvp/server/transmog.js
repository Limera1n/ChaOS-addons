// Some Forever builds expose the base source through both transmog APIs, but
// include the applied appearance's name in the equipped item's tooltip.
const cache = new Map();
const normalize = (name) => name.normalize("NFKD").toLowerCase()
  .replace(/[\u0300-\u036f]/gu, "").replace(/[^a-z0-9]+/gu, " ").trim();
const hiddenNames = new Map([
  [1, "Hidden Helm"], [3, "Hidden Shoulder"], [4, "Hidden Shirt"],
  [5, "Hidden Chest"], [6, "Hidden Belt"], [7, "Hidden Pants"],
  [8, "Hidden Boots"], [9, "Hidden Bracers"], [10, "Hidden Gloves"],
  [15, "Hidden Cloak"], [19, "Hidden Tabard"],
]);

export function tooltipTransmogName(item) {
  if (item.transmogItemId != null && item.transmogItemId !== item.itemId) return null;
  const lines = item.tooltip ?? [];
  const index = lines.findIndex(({ text }) => /^Transmogrified to:\s*$/iu.test(text));
  return index >= 0 ? lines[index + 1]?.text?.trim() || null : null;
}

async function nameShard(key) {
  let entry = cache.get(key);
  if (entry && entry.expires > Date.now()) {
    try { return await entry.body; } catch { return []; }
  }
  if (cache.size >= 32) cache.delete(cache.keys().next().value);
  entry = { expires: Date.now() + 3600000, body: (async () => {
    const response = await fetch(`https://zephras.com/search/${key}.json`, {
      signal: AbortSignal.timeout(5000), redirect: "error",
    });
    if (!response.ok || !response.body) throw new Error("Appearance catalog unavailable");
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 1024 * 1024) throw new Error("Appearance catalog too large");
      chunks.push(chunk);
    }
    const rows = JSON.parse(Buffer.concat(chunks, size));
    if (!Array.isArray(rows)) throw new Error("Invalid appearance catalog");
    return rows.filter((row) => Array.isArray(row) && row[1] === "item"
      && typeof row[0] === "string" && Number.isSafeInteger(row[2]) && row[2] > 0);
  })() };
  cache.set(key, entry);
  try { return await entry.body; }
  catch { if (cache.get(key) === entry) cache.delete(key); return []; }
}

export async function resolveStateTransmogs(state) {
  const names = new Set();
  for (const character of state.characters) for (const snapshot of character.snapshots)
    for (const item of snapshot.equipment ?? []) {
      const name = tooltipTransmogName(item);
      if (name && name !== hiddenNames.get(item.slot)) names.add(normalize(name));
    }
  const keys = [...new Set([...names].map((name) => name.slice(0, 2)).filter((key) => /^[a-z]{2}$/u.test(key)))];
  const rows = [];
  // Limit concurrent catalog requests; all character data stays on this server.
  for (let i = 0; i < keys.length; i += 4)
    rows.push(...(await Promise.all(keys.slice(i, i + 4).map(nameShard))).flat());
  const ids = new Map();
  for (const [name, , id] of rows) {
    const key = normalize(name);
    if (!ids.has(key)) ids.set(key, new Set());
    ids.get(key).add(id);
  }
  return { ...state, characters: state.characters.map((character) => ({
    ...character, snapshots: character.snapshots.map((snapshot) => ({
      ...snapshot, equipment: (snapshot.equipment ?? []).map((item) => {
        const name = tooltipTransmogName(item);
        if (!name) return item;
        if (name === hiddenNames.get(item.slot)) return { ...item, transmogItemId: 0 };
        const matches = ids.get(normalize(name));
        if (matches?.size === 1) return { ...item, transmogItemId: [...matches][0] };
        return { ...item, transmogUnresolved: true };
      }),
    })),
  })) };
}
