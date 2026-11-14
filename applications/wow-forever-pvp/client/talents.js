const escape = (value) => String(value).replace(/[&<>"']/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const selected = (node) => node.entries.find((entry) => entry.id === node.activeEntryId);
export const talentPoints = (tree) => tree.nodes.reduce((total, node) => total + node.spent, 0);
const axes = (nodes, key) => [...new Set(nodes.map((node) => node[key]))].sort((a, b) => a - b);
const classicNames = {
  mage: ["Arcanes", "Feu", "Givre"], druid: ["Équilibre", "Combat farouche", "Restauration"],
  hunter: ["Maîtrise des bêtes", "Précision", "Survie"], paladin: ["Sacré", "Protection", "Vindicte"],
  priest: ["Discipline", "Sacré", "Ombre"], rogue: ["Assassinat", "Combat", "Finesse"],
  shaman: ["Élémentaire", "Amélioration", "Restauration"], warlock: ["Affliction", "Démonologie", "Destruction"],
  warrior: ["Armes", "Fureur", "Protection"],
};
const classAliases = { druide: "druid", chasseur: "hunter", pretre: "priest", voleur: "rogue", chaman: "shaman", demoniste: "warlock", guerrier: "warrior" };

export function talentBranches(tree, characterClass = "") {
  const rows = axes(tree.nodes, "y");
  const branch = (nodes, metadata, index) => ({ ...tree, ...metadata, nodes, rows, columns: axes(nodes, "x"), branchIndex: index });
  if (tree.groups?.length && tree.nodes.every((node) => node.groupId != null)) {
    // Keep cross-group dependencies together rather than silently losing an edge.
    const groups = new Map(tree.nodes.map((node) => [node.id, node.groupId]));
    if (tree.nodes.every((node) => node.edges.every((id) => groups.get(id) === node.groupId))) {
      return [...tree.groups].sort((a, b) => a.order - b.order || a.id - b.id)
        .map((group, index) => branch(tree.nodes.filter((node) => node.groupId === group.id), { name: group.name, icon: group.icon }, index))
        .filter((group) => group.nodes.length);
    }
  }
  // Legacy Forever exports contain one 12-column classic tree (3 × 4).
  // Only split this known geometry when every dependency stays in its branch.
  const columns = axes(tree.nodes, "x");
  if (columns.length === 12) {
    const groupIndex = (node) => Math.floor(columns.indexOf(node.x) / 4);
    const nodes = new Map(tree.nodes.map((node) => [node.id, node]));
    if (tree.nodes.every((node) => node.edges.every((id) => groupIndex(nodes.get(id)) === groupIndex(node)))) {
      const key = String(characterClass ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
      const names = classicNames[classAliases[key] ?? key];
      return Array.from({ length: 3 }, (_, index) => branch(tree.nodes.filter((node) => groupIndex(node) === index), { name: names?.[index] ?? `Branche ${index + 1}` }, index));
    }
  }
  return [branch(tree.nodes, {}, 0)];
}

// Keep the game's ordering in a viewBox that scales to the panel's width.
export function talentLayout(tree) {
  const xs = tree.columns ?? axes(tree.nodes, "x"), ys = tree.rows ?? axes(tree.nodes, "y");
  return { width: Math.max(320, xs.length * 80 + 32), height: ys.length * 88 + 32,
    nodes: tree.nodes.map((node) => ({ ...node, left: 56 + xs.indexOf(node.x) * 80, top: 48 + ys.indexOf(node.y) * 88 })) };
}

function treePanel(tree, index) {
  const layout = talentLayout(tree);
  const nodes = new Map(layout.nodes.map((node) => [node.id, node]));
  const title = tree.name ?? `Arbre ${index + 1}`;
  const key = `${tree.id}-${index}`;
  const points = talentPoints(tree);
  const icon = tree.icon ?? (selected(tree.nodes.find((node) => node.rank > 0) ?? tree.nodes[0]) ?? tree.nodes[0].entries[0]).icon;
  const edges = layout.nodes.flatMap((node) => node.edges.map((id) => {
    const target = nodes.get(id);
    if (!target) return "";
    const below = target.top > node.top;
    const startX = node.left + (below ? 0 : Math.sign(target.left - node.left) * 28);
    const startY = node.top + (below ? 30 : 0);
    const endX = target.left - (below ? 0 : Math.sign(target.left - node.left) * 32);
    const endY = target.top - (below ? 33 : 0);
    const middleY = (startY + endY) / 2;
    return `<path class="talent-edge${node.rank > 0 && target.rank > 0 ? " talent-edge-active" : ""}" d="M ${startX} ${startY} V ${middleY} H ${endX} V ${endY}" marker-end="url(#talent-arrow-${key})"/>`;
  })).join("");
  return `<section class="talent-tree talent-theme-${tree.branchIndex % 3}${points ? " talent-tree-invested" : ""}" aria-labelledby="talent-tree-${key}">
    <div class="talent-branch-heading"><span class="talent-emblem" aria-hidden="true">✦${icon > 0 ? `<img src="https://zephras.com/icons/card/${icon}.jpg" alt="" width="44" height="44" referrerpolicy="no-referrer">` : ""}</span><div><p class="talent-eyebrow">Branche ${index + 1}</p><h4 id="talent-tree-${key}">${escape(title)}</h4></div><div class="talent-branch-points"><strong>${points}</strong><span>point${points === 1 ? "" : "s"}</span></div></div>
    <div class="talent-scroll">
    <svg class="talent-canvas" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" role="group" aria-label="${escape(title)}">
      <defs><marker id="talent-arrow-${key}" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="4" markerHeight="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 Z" fill="context-stroke"/></marker></defs>
      ${edges}
      ${layout.nodes.map((node) => {
        const entry = selected(node) ?? node.entries[0];
        const label = `${entry.name} · rang ${node.rank}/${node.maxRank} · ${node.spent} points investis${node.entries.length > 1 ? ` · Choix : ${node.entries.map((option) => `${option.name}${option.id === node.activeEntryId ? " (sélectionné)" : ""}`).join(" / ")}` : ""}`;
        return `<g class="talent-node${node.rank ? " talent-learned" : ""}${node.rank === node.maxRank && node.maxRank > 0 ? " talent-maxed" : ""}" data-tree-id="${tree.id}" data-node-id="${node.id}" transform="translate(${node.left} ${node.top})" tabindex="0" role="img" aria-label="${escape(label)}">
          <rect class="talent-frame" x="-26" y="-26" width="52" height="52" rx="${node.entries.length > 1 ? 18 : 3}"/>
          <text class="talent-fallback" text-anchor="middle" y="7" aria-hidden="true">✦</text>
          ${entry.icon > 0 ? `<image href="https://zephras.com/icons/card/${entry.icon}.jpg" x="-22" y="-22" width="44" height="44" aria-hidden="true"/>` : ""}
          ${node.rank > 0 ? `<rect class="talent-rank-bg" x="5" y="12" width="28" height="24" rx="3"/><text class="talent-rank" text-anchor="middle" x="19" y="30" aria-hidden="true">${node.rank}</text>` : ""}
        </g>`;
      }).join("")}
    </svg></div><p class="talent-inspect muted" aria-live="polite">Survole ou sélectionne un talent pour afficher son détail.</p>
    <details class="talent-selected-list"><summary>Talents actifs · détail des points</summary><ul>${tree.nodes.filter((node) => node.rank > 0).map((node) => `<li><strong>${escape(selected(node)?.name ?? node.entries[0].name)}</strong> · ${node.rank}/${node.maxRank} · ${node.spent} point${node.spent === 1 ? "" : "s"} investi${node.spent === 1 ? "" : "s"}${node.rank > node.spent ? ` · ${node.rank - node.spent} rang(s) accordé(s)` : ""}</li>`).join("") || "<li>Aucun point attribué dans cet arbre.</li>"}</ul></details>
  </section>`;
}

export function talentsPanel(data, characterClass) {
  if (!data) return `<div id="armory-talents" hidden><h3>Talents</h3><p class="muted">Build non relevé. Installe le collecteur 0.5.17, ouvre les talents en jeu, puis lance /cvp export et importe le relevé.</p></div>`;
  const points = data.trees.reduce((total, tree) => total + talentPoints(tree), 0);
  const branches = data.trees.flatMap((tree) => talentBranches(tree, characterClass));
  return `<div id="armory-talents" hidden><div class="talent-heading"><div><h3>Talents${data.name ? ` · ${escape(data.name)}` : ""}</h3><p class="muted">Build actif relevé le ${escape(new Date(data.at * 1000).toLocaleString("fr-FR"))}.</p></div><strong class="talent-total">${points} points investis</strong></div>
    <p class="talent-legend"><span><i class="talent-legend-maxed"></i>Rang maximum</span><span><i class="talent-legend-learned"></i>Appris</span><span><i></i>Non appris</span><span class="muted">Survole une icône pour consulter le talent.</span></p>
    <div class="talent-branches">${branches.map(treePanel).join("")}</div></div>`;
}

export function bindTalents(root) {
  for (const tree of root.querySelectorAll(".talent-tree")) {
    const info = tree.querySelector(".talent-inspect");
    for (const node of tree.querySelectorAll(".talent-node")) {
      const show = () => { info.textContent = node.getAttribute("aria-label"); };
      node.addEventListener("focus", show);
      node.addEventListener("pointerenter", show);
      node.addEventListener("click", show);
    }
  }
}
