import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createTrackerStore } from "./store.js";
import { MAX_IMPORT_BYTES } from "./import-schema.js";

// This transport is intentionally local. Shared ChaOS hosting needs its account guards.
export function createLocalServer({
  dataDir = fileURLToPath(new URL("../data/", import.meta.url)),
} = {}) {
  const store = createTrackerStore({ dataDir });
  const assets = new Map(
    [
      ["/", ["index.html", "text/html; charset=utf-8"]],
      ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
      ["/style.css", ["style.css", "text/css; charset=utf-8"]],
      ["/model.js", ["model.js", "text/javascript; charset=utf-8"]],
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
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
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
    if (request.method === "GET" && assets.has(request.url)) {
      const asset = assets.get(request.url);
      response.writeHead(200, { "Content-Type": asset.type });
      return response.end(asset.body);
    }
    if (request.method === "GET" && request.url === "/api/state")
      return reply(200, store.read());
    if (request.method !== "POST" || request.url !== "/api/import")
      return reply(404, { error: "Introuvable." });
    if (
      request.headers.origin !== `http://${host}` ||
      request.headers["content-type"] !== "application/json"
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
      const isInputError =
        error instanceof SyntaxError ||
        /Export invalide|Conflit|Limite du prototype/u.test(error.message);
      if (!isInputError) console.error("Tracker import failed", error);
      return reply(isInputError ? 400 : 500, {
        error: isInputError
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
