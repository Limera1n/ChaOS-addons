import { readFileSync } from "node:fs";
import { ARMORY_VIEW_PATH } from "../client/armory.js";

export const ARMORY_SCRIPT_PATH = ARMORY_VIEW_PATH + "/viewer.js";
export const ARMORY_METADATA_PATH = ARMORY_VIEW_PATH + "/metadata";
export const ARMORY_ASSET_PATH = ARMORY_VIEW_PATH + "/assets/";
const viewerScript = readFileSync(new URL("../client/armory-viewer.js", import.meta.url));
const metadataCache = new Map();
const assetCache = new Map();
const assetRequests = new Map();
let assetBytes = 0;
const MAX_ASSET_BYTES = 32 * 1024 * 1024;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;

async function readBounded(response, maxBytes) {
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw new Error("Remote asset unavailable");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Remote asset too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

export async function serveArmoryAsset(request, response) {
  const path = new URL(request.url, "http://localhost").pathname.slice(ARMORY_ASSET_PATH.length);
  const match = /^(wowbocho-own(?:fi|i|f[2-8]?|[2-9]|[12]\d|3[0-8])?)\/((?:[a-z0-9_-]+\/)*[a-z0-9_-]+(?:\.[a-z0-9]+)?)$/u.exec(path);
  if (!match || !/\.(?:json|wbm|wba|webp|avif|png|ktx2|bin)$/u.test(match[2])) {
    response.writeHead(400).end();
    return;
  }
  const now = Date.now();
  let cached = assetCache.get(path);
  if (cached && cached.expires <= now) {
    assetBytes -= cached.body.length;
    assetCache.delete(path);
    cached = null;
  }
  try {
    if (!cached) {
      let pending = assetRequests.get(path);
      if (!pending) {
        pending = (async () => {
          const upstream = await fetch(`https://${match[1]}.pages.dev/${match[2]}`, { signal: AbortSignal.timeout(20000), redirect: "error" });
          const body = await readBounded(upstream, MAX_ASSET_BYTES);
          const entry = { body, expires: Date.now() + 3600000, type: upstream.headers.get("content-type") ?? "application/octet-stream" };
          while (assetCache.size && (assetBytes + body.length > MAX_CACHE_BYTES || assetCache.size >= 256)) {
            const oldest = assetCache.keys().next().value;
            assetBytes -= assetCache.get(oldest).body.length;
            assetCache.delete(oldest);
          }
          assetCache.set(path, entry);
          assetBytes += body.length;
          return entry;
        })();
        assetRequests.set(path, pending);
        pending.finally(() => assetRequests.delete(path)).catch(() => {});
      }
      cached = await pending;
    }
    response.writeHead(200, { "Content-Type": cached.type, "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" }).end(cached.body);
  } catch {
    response.writeHead(502).end();
  }
}

const gearCode = /^[a-s][1-9]\d{0,9}(?:e[1-9]\d{0,8})?(?:\.[a-s][1-9]\d{0,9}(?:e[1-9]\d{0,8})?){0,18}$/u;
const appearanceCode = /^[01](?:b(?:1|2|3|4|5|6|95))?(?:\.[1-9]\d{0,8}-[1-9]\d{0,8}(?:~[1-9]\d{0,8}-[1-9]\d{0,8}){0,63})?$/u;

export function serveArmoryScript(_request, response) {
  response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" }).end(viewerScript);
}

async function loadVariants(model) {
  const upstream = await fetch(`https://wow.zamimg.com/modelviewer/classicplus/meta/charactercustomization/${model}.json`, {
    signal: AbortSignal.timeout(10000), redirect: "error",
  });
  const metadata = JSON.parse(await readBounded(upstream, 4 * 1024 * 1024));
  return JSON.stringify(metadata.AltVariant?.Options ?? []);
}

export async function serveArmoryMetadata(request, response) {
  const raw = new URL(request.url, "http://localhost").searchParams.get("model");
  const model = Number(raw);
  if (!/^\d{1,3}$/u.test(raw ?? "") || !((model >= 1 && model <= 18) || model === 218 || model === 219)) {
    response.writeHead(400).end();
    return;
  }
  let entry = metadataCache.get(model);
  if (!entry || entry.expires <= Date.now()) {
    entry = { expires: Date.now() + 3600000, body: loadVariants(model) };
    metadataCache.set(model, entry);
  }
  try {
    const body = await entry.body;
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=3600" }).end(body);
  } catch {
    if (metadataCache.get(model) === entry) metadataCache.delete(model);
    response.writeHead(502).end();
  }
}

export function serveArmory(request, response) {
  const { searchParams } = new URL(request.url, "http://localhost");
  const race = searchParams.get("r") ?? "";
  const body = searchParams.get("a");
  const gear = searchParams.get("g") ?? "";
  const mode = searchParams.get("m");
  const validRace = /^(?:[1-9]|95|96)$/u.test(race);
  const valid = validRace && appearanceCode.test(body ?? "") && (!gear || gearCode.test(gear));
  if (!valid || (mode !== null && mode !== "sd" && mode !== "hd")) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Paramètres du portrait 3D invalides.");
    return;
  }
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": "default-src 'none'; script-src 'self' 'unsafe-eval' https://wowbocho.com/tools/own-viewer/; connect-src 'self' https://wowbocho.com/; img-src blob: data:; frame-ancestors 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    "Referrer-Policy": "no-referrer",
  });
  response.end(`<!doctype html>
<html lang="fr">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Portrait 3D</title>
<style>
:root { color-scheme: dark }
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; color: #fff3dc; font: 12px system-ui, sans-serif }
#stage, .model { position: absolute; inset: 0; width: 100%; height: 100% }
#controls { position: absolute; top: 10px; right: 10px; z-index: 1; display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid #c49b48; border-radius: 6px; background: #181c16; color: #fff3dc; font-weight: 700; box-shadow: 0 2px 8px #0008 }
select, button { color: #ffc54e; background: #16120c; border: 1px solid #bc914c; border-radius: 4px; padding: 4px }
#definition { min-height: 32px; padding: 5px 10px; background: #ffcc55; color: #211707; border-color: #ffe6a6; font: 700 14px system-ui, sans-serif; color-scheme: light; cursor: pointer }
#definition:focus-visible { outline: 2px solid #fff; outline-offset: 3px }
#status { position: absolute; bottom: 18px; left: 12px; right: 12px; z-index: 1; margin: 0; text-align: center; text-shadow: 0 1px 3px #000 }
#credit { position: absolute; bottom: 2px; right: 8px; font-size: 9px; color: #c1baa8; text-decoration: none }
</style>
<div id="stage" aria-label="Portrait 3D du personnage"></div>
<div id="controls"><label for="definition">Qualité du modèle</label><select id="definition"><option value="sd">SD</option><option value="hd">HD</option></select><button id="retry" hidden>Réessayer</button></div>
<p id="status" role="status">Chargement du personnage…</p>
<a id="credit" href="https://wowbocho.com/npc3d/?gv=forever" target="_blank" rel="noopener noreferrer">Moteur WoWBocho · Modèles © Blizzard</a>
<script type="module" src="${ARMORY_SCRIPT_PATH}"></script>
</html>`);
}
