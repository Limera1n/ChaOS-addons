const escape = (value) => String(value).replace(/[&<>"']/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const date = (at) => new Date(at * 1000).toLocaleString("fr-FR");

export function professionsPanel(data) {
  if (!data) return `<div id="armory-professions" hidden><h3>Métiers</h3><p class="muted">Métiers non relevés. Installe le collecteur 0.5.15, ouvre chaque métier en jeu, puis lance /cvp export et importe le relevé.</p></div>`;
  return `<div id="armory-professions" hidden>
    <div class="profession-heading"><div><h3>Métiers</h3><p class="muted">Niveaux relevés le ${escape(date(data.at))}.</p></div>
    <label>Rechercher une recette <input type="search" id="recipe-search" placeholder="Nom du craft…"></label></div>
    <p class="muted">Recettes apprises et quantités fabricables au moment du relevé. Ouvre chaque métier en jeu avant /cvp export pour actualiser sa liste. Les quantités dépendent des composants et des conditions en jeu.</p>
    <div class="profession-list">${data.items.length ? data.items.map((item) => `<section class="profession-card" aria-labelledby="profession-${item.skillLineId}">
      <div class="profession-heading"><h4 id="profession-${item.skillLineId}">${escape(item.name)}</h4><strong>${item.rank} / ${item.maxRank}</strong></div>
      <progress value="${item.rank}" max="${item.maxRank}" aria-label="Niveau de ${escape(item.name)}">${item.rank} / ${item.maxRank}</progress>
      ${item.recipes == null ? '<p class="muted">Recettes non relevées. Ouvre ce métier en jeu pour les récupérer si disponibles.</p>' : `<details open><summary>${item.recipes.length} recette${item.recipes.length === 1 ? "" : "s"} apprise${item.recipes.length === 1 ? "" : "s"}</summary>
      <p class="muted">Recettes et quantités relevées le ${escape(date(item.recipesAt))}.</p>
      <div class="table-scroll profession-recipes"><table><thead><tr><th>Craft</th><th>Quantité fabricable</th></tr></thead><tbody>${item.recipes.map((recipe) => `<tr data-recipe-name="${escape(recipe.name.toLocaleLowerCase("fr"))}"><td>${escape(recipe.name)}</td><td>${recipe.available == null ? "Non relevée" : recipe.available}</td></tr>`).join("")}</tbody></table></div>
      <p class="muted recipe-empty"${item.recipes.length ? " hidden" : ""}>Aucune recette correspondante.</p></details>`}
    </section>`).join("") : '<p class="muted">Aucun métier appris dans ce relevé.</p>'}</div></div>`;
}

export function bindProfessionSearch(root) {
  root.querySelector("#recipe-search")?.addEventListener("input", (event) => {
    const query = event.target.value.trim().toLocaleLowerCase("fr");
    for (const card of root.querySelectorAll(".profession-card")) {
      const rows = [...card.querySelectorAll("[data-recipe-name]")];
      for (const row of rows) row.hidden = !row.dataset.recipeName.includes(query);
      const empty = card.querySelector(".recipe-empty");
      if (empty) empty.hidden = rows.some((row) => !row.hidden);
    }
  });
}
