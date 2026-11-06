import { ARMORY_EMBED_URL } from "../client/armory.js";

const gearCode = /^[a-s][1-9]\d{0,9}(?:e[1-9]\d{0,8})?(?:\.[a-s][1-9]\d{0,9}(?:e[1-9]\d{0,8})?){0,18}$/u;
const appearanceCode = /^[01](?:b(?:1|2|3|4|5|6|95))?(?:\.[1-9]\d{0,8}-[1-9]\d{0,8}(?:~[1-9]\d{0,8}-[1-9]\d{0,8}){0,63})?$/u;

// Only this document can frame the external dressing room.
export function serveArmory(request, response) {
  const { searchParams } = new URL(request.url, "http://localhost");
  const race = searchParams.get("r") ?? "";
  const body = searchParams.get("a");
  const gear = searchParams.get("g") ?? "";
  if (!/^[1-9]\d{0,4}$/u.test(race) || !appearanceCode.test(body ?? "") || (gear && !gearCode.test(gear))) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Paramètres du portrait 3D invalides.");
    return;
  }
  const url = new URL(ARMORY_EMBED_URL);
  url.searchParams.set("r", race);
  url.searchParams.set("a", body);
  if (gear) url.searchParams.set("g", gear);
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": `default-src 'none'; frame-src ${ARMORY_EMBED_URL}; frame-ancestors 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`,
    "Referrer-Policy": "no-referrer",
  });
  response.end(`<!doctype html>
<html lang="fr">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Portrait 3D</title>
<style>body { margin: 0 } iframe { display: block; border: 0; width: 100vw; height: 100vh }</style>
<iframe title="Vestiaire WoW Forever" sandbox="allow-scripts allow-same-origin" src="${url.href.replaceAll("&", "&amp;")}"></iframe>
</html>`);
}
