// Forever's CAMWOW realm labels describe layers, not separate populations.
// Keep unclassified legacy imports isolated until their ruleset is known.
export function identityRuleset(character) {
  const explicit = character.ruleset?.trim().toLowerCase();
  if (explicit && explicit !== "unknown") return explicit;
  return character.realm?.match(/\b(pvp|pve|hardcore)\s*$/iu)?.[1].toLowerCase() ?? "unknown";
}

export function identityScope(character) {
  const ruleset = identityRuleset(character);
  return ruleset === "unknown"
    ? [character.region, ruleset, character.realm]
    : [character.region, ruleset];
}

export function playerName(character) {
  const suffix = `-${character.realm}`;
  return character.name.toLowerCase().endsWith(suffix.toLowerCase())
    ? character.name.slice(0, -suffix.length) : character.name;
}

export function playerKey(character) {
  return JSON.stringify([...identityScope(character), playerName(character)]);
}

export function scopeLabel(character) {
  const region = ({ 1: "US", 2: "KR", 3: "EU", 4: "TW", 5: "CN" })[character.region] ?? character.region;
  const ruleset = identityRuleset(character);
  return `${region} · ${({ pvp: "PvP", pve: "PvE", hardcore: "Hardcore", unknown: "Ruleset non renseigné" })[ruleset] ?? ruleset}`;
}

// Preserve links shared before layer-based keys were replaced.
export function canonicalLinkKey(key, entity = "guild") {
  try {
    const parts = JSON.parse(key);
    if (!Array.isArray(parts) || !parts.every((part) => typeof part === "string")) return key;
    if (parts.length !== 4) return key;
    const [region, ruleset, realm, name] = parts;
    const character = { region, ruleset, realm, name };
    return JSON.stringify([...identityScope(character), entity === "player" ? playerName(character) : name]);
  } catch {
    return key;
  }
}
