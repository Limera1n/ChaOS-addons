const escape = (value) => String(value).replace(/[&<>"']/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const selected = (node) => node.entries.find((entry) => entry.id === node.activeEntryId);
export const talentPoints = (tree) => tree.nodes.reduce((total, node) => total + node.spent, 0);

// Retain the game's row/column ordering with room for readable, fixed-size icons.
// A wide tree scrolls horizontally instead of shrinking ranks on mobile.
export function talentLayout(tree) {
  const axis = (key) => [...new Set(tree.nodes.map((node) => node[key]))].sort((a, b) => a - b);
  const xs = axis("x"), ys = axis("y");
  return { width: Math.max(320, xs.length * 80 + 32), height: ys.length * 88 + 32,
    nodes: tree.nodes.map((node) => ({ ...node, left: 56 + xs.indexOf(node.x) * 80, top: 48 + ys.indexOf(node.y) * 88 })) };
}

function treePanel(tree, index) {
  const layout = talentLayout(tree);
  const nodes = new Map(layout.nodes.map((node) => [node.id, node]));
  const title = tree.name ?? `Arbre ${index + 1}`;
  const edges = layout.nodes.flatMap((node) => node.edges.map((id) => {
    const target = nodes.get(id);
    if (!target) return "";
    return `<line class="talent-edge${node.rank > 0 && target.rank > 0 ? " talent-edge-active" : ""}" x1="${node.left}" y1="${node.top}" x2="${target.left}" y2="${target.top}"/>`;
  })).join("");
  return `<section class="talent-tree" aria-labelledby="talent-tree-${tree.id}">
    <div class="talent-heading"><h4 id="talent-tree-${tree.id}">${escape(title)}</h4><strong>${talentPoints(tree)} points investis</strong></div>
    <div class="talent-scroll" tabindex="0" aria-label="${escape(title)} · arbre défilant">
    <svg class="talent-canvas" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" role="group" aria-label="${escape(title)}">
      ${edges}
      ${layout.nodes.map((node) => {
        const entry = selected(node) ?? node.entries[0];
        const label = `${entry.name} · rang ${node.rank}/${node.maxRank} · ${node.spent} points investis${node.entries.length > 1 ? ` · Choix : ${node.entries.map((option) => `${option.name}${option.id === node.activeEntryId ? " (sélectionné)" : ""}`).join(" / ")}` : ""}`;
        return `<g class="talent-node${node.rank ? " talent-learned" : ""}${node.rank === node.maxRank && node.maxRank > 0 ? " talent-maxed" : ""}" transform="translate(${node.left} ${node.top})" tabindex="0" role="img" aria-label="${escape(label)}">
          <title>${escape(label)}</title><rect class="talent-frame" x="-26" y="-26" width="52" height="52" rx="${node.entries.length > 1 ? 18 : 5}"/>
          <text class="talent-fallback" text-anchor="middle" y="7" aria-hidden="true">✦</text>
          ${entry.icon > 0 ? `<image href="https://zephras.com/icons/card/${entry.icon}.jpg" x="-22" y="-22" width="44" height="44" aria-hidden="true"/>` : ""}
          <rect class="talent-rank-bg" x="-23" y="17" width="46" height="21" rx="3"/><text class="talent-rank" text-anchor="middle" y="32" aria-hidden="true">${node.rank}/${node.maxRank}</text>
        </g>`;
      }).join("")}
    </svg></div><p class="talent-inspect muted" aria-live="polite">Survole ou sélectionne un talent pour afficher son détail.</p>
    <details class="talent-selected-list"><summary>Talents actifs · détail des points</summary><ul>${tree.nodes.filter((node) => node.rank > 0).map((node) => `<li><strong>${escape(selected(node)?.name ?? node.entries[0].name)}</strong> · ${node.rank}/${node.maxRank} · ${node.spent} point${node.spent === 1 ? "" : "s"} investi${node.spent === 1 ? "" : "s"}${node.rank > node.spent ? ` · ${node.rank - node.spent} rang(s) accordé(s)` : ""}</li>`).join("") || "<li>Aucun point attribué dans cet arbre.</li>"}</ul></details>
  </section>`;
}

export function talentsPanel(data) {
  if (!data) return `<div id="armory-talents" hidden><h3>Talents</h3><p class="muted">Build non relevé. Installe le collecteur 0.5.16, ouvre les talents en jeu, puis lance /cvp export et importe le relevé.</p></div>`;
  const points = data.trees.reduce((total, tree) => total + talentPoints(tree), 0);
  return `<div id="armory-talents" hidden><div class="talent-heading"><div><h3>Talents${data.name ? ` · ${escape(data.name)}` : ""}</h3><p class="muted">Build actif relevé le ${escape(new Date(data.at * 1000).toLocaleString("fr-FR"))}.</p></div><strong class="talent-total">${points} points investis</strong></div>
    <p class="muted">Build validé en jeu. Survole un talent ou sélectionne-le au clavier pour lire son nom et ses rangs. Doré : rang maximum · Vert : talent appris · Gris : non appris. Les rangs accordés sont distingués des points investis dans le détail.</p>
    ${data.trees.map(treePanel).join("")}</div>`;
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
