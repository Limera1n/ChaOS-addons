import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createTrackerStore } from "./store.js";
import { MAX_IMPORT_BYTES } from "./import-schema.js";
import { API_PATH, IMPORT_TYPE, importErrorStatus } from "./routes.js";
import { ARMORY_VIEW_PATH } from "../client/armory.js";
import { ARMORY_SCRIPT_PATH, ARMORY_METADATA_PATH, ARMORY_ASSET_PATH, serveArmory, serveArmoryScript, serveArmoryMetadata, serveArmoryAsset } from "./armory.js";
import { ITEM_TOOLTIP_PATH, serveItemTooltips } from "./item-tooltips.js";

// This transport is intentionally local and has no accounts: ChaOS serves the
// same client through server/index.js, behind its account guards.
export function createLocalServer({
  dataDir = fileURLToPath(new URL("../data/", import.meta.url)),
} = {}) {
  const store = createTrackerStore({ dataDir });
  const assets = new Map(
    [
      ["/", ["index.html", "text/html; charset=utf-8"]],
      ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
      ["/desktop-cursor.js", ["desktop-cursor.js", "text/javascript; charset=utf-8"]],
      ["/style.css", ["style.css", "text/css; charset=utf-8"]],
      ["/model.js", ["model.js", "text/javascript; charset=utf-8"]],
      ["/identity.js", ["identity.js", "text/javascript; charset=utf-8"]],
      ["/activity.js", ["activity.js", "text/javascript; charset=utf-8"]],
      ["/map-regions.js", ["map-regions.js", "text/javascript; charset=utf-8"]],
      ["/map-outlines.js", ["map-outlines.js", "text/javascript; charset=utf-8"]],
      ["/armory.js", ["armory.js", "text/javascript; charset=utf-8"]],
      ["/item-tooltips.js", ["item-tooltips.js", "text/javascript; charset=utf-8"]],
      ...["human", "orc", "dwarf", "nightelf", "scourge", "tauren", "skyborne"]
        .map((scene) => [`/scenes/${scene}.webp`, [`scenes/${scene}.webp`, "image/webp"]]),
    ].map(([path, [file, type]]) => [
      path,
      {
        body: readFileSync(new URL(`../client/${file}`, import.meta.url)),
        type,
      },
    ]),
  );
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://zephras.com/icons/card/ https://wowforever-media.fly.storage.tigris.dev/maps/ https://mattjcr.github.io/wowforeverultimatecalculator/models/1.60.1.70790/scene/; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    const reply = (status, value) => {
      response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify(value));
    };
    const host = `127.0.0.1:${server.address().port}`;
    if (request.headers.host !== host)
      return reply(403, { error: "Accès local uniquement." });
    if (request.headers.origin && request.headers.origin !== `http://${host}`)
      return reply(403, { error: "Origine refusée." });
    if (request.method === "GET" && request.url.split("?", 1)[0] === ARMORY_VIEW_PATH)
      return serveArmory(request, response);
    if (request.method === "GET" && request.url.split("?", 1)[0] === ARMORY_SCRIPT_PATH)
      return serveArmoryScript(request, response);
    if (request.method === "GET" && request.url.split("?", 1)[0] === ARMORY_METADATA_PATH)
      return serveArmoryMetadata(request, response);
    if (request.method === "GET" && request.url.startsWith(ARMORY_ASSET_PATH))
      return serveArmoryAsset(request, response);
    if (request.method === "GET" && request.url.split("?", 1)[0] === ITEM_TOOLTIP_PATH)
      return serveItemTooltips(request, response);
    if (request.method === "GET" && assets.has(request.url)) {
      const asset = assets.get(request.url);
      response.writeHead(200, { "Content-Type": asset.type });
      return response.end(asset.body);
    }
    if (request.method === "GET" && request.url === API_PATH + "/state")
      return reply(200, store.read());
    if (request.method !== "POST" || request.url !== API_PATH + "/import")
      return reply(404, { error: "Introuvable." });
    if (
      request.headers.origin !== `http://${host}` ||
      request.headers["content-type"] !== IMPORT_TYPE
    ) {
      return reply(403, {
        error: "Import depuis cette application uniquement.",
      });
    }
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_IMPORT_BYTES) {
          reply(413, { error: "Export trop volumineux (2 Mio maximum)." });
          request.resume();
          return;
        }
        chunks.push(chunk);
      }
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      return reply(200, store.importBatch(input));
    } catch (error) {
      const status = importErrorStatus(error);
      if (status === 500) console.error("Tracker import failed", error);
      return reply(status, {
        error:
          status === 400
            ? error.message
            : "Échec de sauvegarde ; import non appliqué.",
      });
    }
  });
  server.requestTimeout = 15000;
  server.on("close", () => store.stop());
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = createLocalServer();
  server.listen(4783, "127.0.0.1", () =>
    console.info("WoW Forever PvP : http://127.0.0.1:4783"),
  );
  server.on("error", (error) => {
    console.error("Local tracker failed", error);
    process.exitCode = 1;
  });
  const stop = () => server.close();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
