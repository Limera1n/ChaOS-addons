import { API_PATH } from "./routes.js";

export const ITEM_TOOLTIP_PATH = API_PATH + "/item-tooltip";
const SHARDS = 256;
const MAX_BYTES = 256 * 1024;
const CACHE_LIMIT = 32;
const CACHE_TTL = 60 * 60 * 1000;
const cache = new Map();

async function loadShard(shard) {
  const response = await fetch(`https://zephras.com/tips/item/${shard}/`, {
    signal: AbortSignal.timeout(5000),
    redirect: "error",
  });
  if (!response.ok || !response.body) throw new Error("Tooltip catalog unavailable");
  let bytes = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > MAX_BYTES) throw new Error("Tooltip catalog response too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, bytes);
}

export async function serveItemTooltips(request, response) {
  const shard = new URL(request.url, "http://localhost").searchParams.get("shard");
  if (!/^\d{1,3}$/u.test(shard ?? "") || Number(shard) >= SHARDS) {
    response.writeHead(400).end();
    return;
  }
  const key = Number(shard);
  let entry = cache.get(key);
  if (!entry || entry.expires <= Date.now()) {
    cache.delete(key);
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
    entry = { expires: Date.now() + CACHE_TTL, body: loadShard(key) };
    cache.set(key, entry);
  }
  try {
    const body = await entry.body;
    response.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=3600",
    }).end(body);
  } catch {
    if (cache.get(key) === entry) cache.delete(key);
    response.writeHead(502).end();
  }
}
