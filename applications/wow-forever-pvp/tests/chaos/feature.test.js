// Runs inside the ChaOS site (`npm run test:addons`), with its real HTTP app,
// accounts and sessions. The standalone `npm test` only covers tests/*.test.js.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHttpApp } from "../../../../server/http/app.js";
import {
  createAccount,
  createSession,
  SESSION_COOKIE,
} from "../../../../server/auth/service.js";
import { db } from "../../../../server/db/index.js";
import { createWowForeverPvpFeature } from "../../server/index.js";
import { API_PATH, IMPORT_TYPE } from "../../server/routes.js";

after(() => db.close());

const batch = {
  format: "chaos-world-pvp",
  version: 1,
  sourceId: "installation-a",
  addonVersion: "0.1.0",
  build: "test-only",
  exportedAt: 200,
  character: {
    name: "Tester",
    realm: "Realm",
    region: "3",
    ruleset: "unknown",
    level: 60,
  },
  snapshots: [{ id: "1", at: 100, lifetimeHK: 10, equipment: [] }],
  events: [
    { id: "2", at: 120, type: "honor-gain", amount: 2, context: "world" },
  ],
};

test("ChaOS accounts import from the site only; everyone reads the shared tracker", async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "wow-forever-pvp-"));
  const feature = createWowForeverPvpFeature({ dataDir });
  const app = createHttpApp();
  feature.routes(app);
  const server = createServer(app);
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(async () => {
    feature.stop();
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    rmSync(dataDir, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { account } = await createAccount({
    email: `wow-${crypto.randomUUID()}@example.test`,
    pseudo: `Wow ${crypto.randomUUID().slice(0, 8)}`,
    password: "wow-forever-pvp-test-password",
  });
  const cookie = `${SESSION_COOKIE}=${createSession(account.id)}`;
  const post = (body, headers = {}) =>
    fetch(origin + API_PATH + "/import", {
      method: "POST",
      headers: {
        "Content-Type": IMPORT_TYPE,
        Cookie: cookie,
        Origin: origin,
        ...headers,
      },
      body,
    });

  assert.equal((await post(JSON.stringify(batch), { Cookie: "" })).status, 401);
  assert.equal(
    (await post(JSON.stringify(batch), { Origin: "https://other.invalid" }))
      .status,
    403,
  );
  assert.equal(
    (await post(JSON.stringify(batch), { "Content-Type": "application/json" }))
      .status,
    415,
  );
  // Larger than the site's 1 MiB JSON limit, within the export's own 2 MiB.
  assert.equal((await post(" ".repeat(1.5 * 1024 * 1024) + "{")).status, 400);
  assert.equal((await post("x".repeat(2 * 1024 * 1024 + 1))).status, 413);
  const imported = await post(JSON.stringify(batch));
  assert.equal(imported.status, 200);
  assert.equal((await imported.json()).added, 2);

  const state = await (await fetch(origin + API_PATH + "/state")).json();
  assert.deepEqual(
    state.characters.map((character) => character.name),
    ["Tester"],
  );
});
