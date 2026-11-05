// Paths shared by the ChaOS feature and the local prototype server, so the
// same client works in both.
export const API_PATH = "/api/wow-forever-pvp";
// A dedicated media type keeps the import out of the site's 1 MiB JSON parser
// and forces a CORS preflight: another site cannot post it with a form.
export const IMPORT_TYPE = "application/vnd.chaos-world-pvp+json";

export function importErrorStatus(error) {
  return error instanceof SyntaxError ||
    /Export invalide|Conflit|Limite du prototype/u.test(error.message)
    ? 400
    : 500;
}
