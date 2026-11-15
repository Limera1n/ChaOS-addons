const normalize = (text) => text.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase();
const headerPattern = /^(.+?)\s*\((\d+)\s*\/\s*(\d+)\)\s*$/u;
const bonusPattern = /^\((\d+)\)\s*(?:set|ensemble)\s*:\s*(.+)$/iu;
const footerPattern = /^(?:(?:requires?|requiert|niveau requis)\s|(?:durability|durabilité)\s+\d|(?:sell price|prix de vente|transmogrified to|transmogrifié en|transmogrification|enchanted|enchanté|enchantement)\s*:|"|«)/iu;

// The inventory tooltip's count describes the actual loadout at export time.
// Never infer bag/bank ownership from a missing equipped piece.
export function equipmentSetLines(lines, equipment = [], { base = false } = {}) {
  const equippedNames = new Set(equipment.flatMap((item) => {
    const name = item.name ?? item.link?.match(/\[([^\]]+)\]/u)?.[1];
    return name ? [normalize(name)] : [];
  }));
  const result = lines.map((line) => ({ ...line }));
  for (let index = 0; index < result.length; index++) {
    const header = result[index].text.trim().match(headerPattern);
    if (!header) continue;
    const members = [], bonuses = [];
    let end = index + 1, sawBonus = false;
    for (; end < result.length; end++) {
      const line = result[end], text = line.text.trim();
      if (headerPattern.test(text) || footerPattern.test(text)) break;
      const bonus = text.match(bonusPattern);
      if (bonus) {
        sawBonus = true;
        bonuses.push({ line, required: Number(bonus[1]), description: bonus[2] });
      } else if (!sawBonus && text && !line.right && members.length < Number(header[3])) {
        members.push(line);
      } else if (text) break;
    }
    // Avoid treating unrelated fractions as item sets.
    if (!members.length && !bonuses.length) continue;
    const count = base ? members.filter((line) => equippedNames.has(normalize(line.text))).length : Number(header[2]);
    result[index].set = { kind: "header", name: header[1], count, total: Number(header[3]) };
    for (const line of members) {
      line.set = { kind: "piece", equipped: equippedNames.has(normalize(line.text)) || (!base && line.effect === true) };
    }
    for (const { line, required, description } of bonuses) {
      line.set = { kind: "bonus", active: count >= required, required, description };
    }
    index = end - 1;
  }
  return result;
}
