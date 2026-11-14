// Values are effective readings from the game, including equipment and buffs.
export const statGroups = [
  ["Caractéristiques", [["health", "Vie"], ["power", "Ressource"], ["strength", "Force"], ["agility", "Agilité"], ["stamina", "Endurance"], ["intellect", "Intelligence"], ["spirit", "Esprit"]]],
  ["Armes", [["mainMin", "Main droite · minimum"], ["mainMax", "Main droite · maximum"], ["offMin", "Main gauche · minimum"], ["offMax", "Main gauche · maximum"], ["attackPower", "Puissance d’attaque"], ["attackSpeed", "Vitesse · main droite", "s"], ["rangedMin", "Distance · minimum"], ["rangedMax", "Distance · maximum"], ["rangedPower", "Puissance à distance"]]],
  ["Modificateurs", [["meleeHit", "Toucher · mêlée", "%"], ["rangedHit", "Toucher · distance", "%"], ["spellHit", "Toucher · sorts", "%"], ["meleeCrit", "Critique · mêlée", "%"], ["rangedCrit", "Critique · distance", "%"], ["spellCrit", "Critique · sorts", "%"], ["spellHealing", "Bonus aux soins"]]],
  ["Défense", [["armor", "Armure"], ["defense", "Compétence de défense"], ["dodge", "Esquive", "%"], ["parry", "Parade", "%"], ["block", "Blocage", "%"], ["blockValue", "Valeur de blocage"]]],
  ["Magie · bonus aux dégâts", [["holyDamage", "Sacré"], ["fireDamage", "Feu"], ["natureDamage", "Nature"], ["frostDamage", "Givre"], ["shadowDamage", "Ombre"], ["arcaneDamage", "Arcanes"]]],
  ["Résistances", [["holyResistance", "Sacré"], ["fireResistance", "Feu"], ["natureResistance", "Nature"], ["frostResistance", "Givre"], ["shadowResistance", "Ombre"], ["arcaneResistance", "Arcanes"]]],
];

export const statKeys = statGroups.flatMap(([, rows]) => rows.map(([key]) => key));

export function formatStat(value, unit = "") {
  if (!Number.isFinite(value)) return "—";
  return `${value.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ""}`;
}
