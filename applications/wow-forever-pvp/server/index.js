// ChaOS integration: the tracker is read by everyone on the shared desktop and
// fed by signed-in accounts from this site only. Nothing opens before the
// first request, so importing this module starts no work.
import express from "express";
import { fileURLToPath } from "node:url";
import { defineFeature } from "../../../../server/core/features.js";
import { requireAccount, requireSameOrigin } from "../../../../server/api/auth.js";
import { createTrackerStore } from "./store.js";
import { MAX_IMPORT_BYTES } from "./import-schema.js";
import { API_PATH, IMPORT_TYPE, importErrorStatus } from "./routes.js";
import { ARMORY_VIEW_PATH } from "../client/armory.js";
import { ARMORY_SCRIPT_PATH, ARMORY_METADATA_PATH, ARMORY_ASSET_PATH, serveArmory, serveArmoryScript, serveArmoryMetadata, serveArmoryAsset } from "./armory.js";
import { ITEM_TOOLTIP_PATH, serveItemTooltips } from "./item-tooltips.js";

const passThrough = (_request, _response, next) => next();

export function createWowForeverPvpFeature({
  dataDir = fileURLToPath(new URL("../data/", import.meta.url)),
} = {}) {
  let store = null;
  const openStore = () => (store ??= createTrackerStore({ dataDir }));
  return defineFeature({
    id: "wowForeverPvp",
    routes(app, { apiLimiter = passThrough } = {}) {
      app.get(ARMORY_VIEW_PATH, apiLimiter, serveArmory);
      app.get(ARMORY_SCRIPT_PATH, apiLimiter, serveArmoryScript);
      app.get(ARMORY_METADATA_PATH, apiLimiter, serveArmoryMetadata);
      app.get(new RegExp(`^${ARMORY_ASSET_PATH}`), serveArmoryAsset);
      app.get(ITEM_TOOLTIP_PATH, apiLimiter, serveItemTooltips);
      app.get(API_PATH + "/state", apiLimiter, (_request, response) => {
        response.json(openStore().read());
      });
      app.post(
        API_PATH + "/import",
        apiLimiter,
        requireAccount,
        requireSameOrigin,
        express.text({ type: IMPORT_TYPE, limit: MAX_IMPORT_BYTES }),
        (request, response) => {
          if (!request.is(IMPORT_TYPE) || typeof request.body !== "string")
            return response
              .status(415)
              .json({ error: "Format d’import non reconnu." });
          try {
            response.json(openStore().importBatch(JSON.parse(request.body)));
          } catch (error) {
            const status = importErrorStatus(error);
            if (status === 500)
              console.error("[wow-forever-pvp] import failed", error);
            response.status(status).json({
              error:
                status === 400
                  ? error.message
                  : "Échec de sauvegarde ; import non appliqué.",
            });
          }
        },
      );
      // The text parser refuses oversized bodies before the handler runs.
      app.use(API_PATH, (error, _request, response, next) => {
        if (error?.type !== "entity.too.large") return next(error);
        response
          .status(413)
          .json({ error: "Export trop volumineux (2 Mio maximum)." });
      });
    },
    stop() {
      store?.stop();
    },
    status() {
      return store?.status() ?? { isStopped: false, characters: null };
    },
  });
}

export default createWowForeverPvpFeature();
