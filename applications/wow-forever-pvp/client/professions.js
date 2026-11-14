const escape = (value) => String(value).replace(/[&<>"']/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const date = (at) => new Date(at * 1000).toLocaleString("fr-FR");

export function groupRecipes(recipes) {
  const root = { children: new Map(), recipes: [] };
  for (const recipe of recipes) {
    let group = root;
    const path = recipe.categoryPath?.length ? recipe.categoryPath : [{ id: "unknown", name: "Catégorie non relevée", order: Infinity }];
    for (const category of path) {
      if (!group.children.has(category.id)) group.children.set(category.id, { ...category, children: new Map(), recipes: [] });
      group = group.children.get(category.id);
    }
    group.recipes.push(recipe);
  }
  const finish = (group) => {
    const children = [...group.children.values()].sort((a, b) => a.order - b.order || a.id - b.id).map(finish);
    // Exports store recipes in ascending order; show the last crafts first.
    return { ...group, recipes: [...group.recipes].reverse(), children,
      count: group.recipes.length + children.reduce((total, child) => total + child.count, 0) };
  };
  return finish(root).children;
}

function recipeList(recipes, profession) {
  if (!recipes.length) return "";
  return `<ul class="profession-recipes">${recipes.map((recipe) => `<li data-recipe-name="${escape([recipe.name, ...(recipe.categoryPath ?? []).map((category) => category.name)].join(" ").toLocaleLowerCase("fr"))}"><button type="button" class="recipe" data-recipe-id="${recipe.id}" data-profession-id="${profession.skillLineId}">
    <span class="recipe-icon" aria-hidden="true"><span>✦</span>${recipe.icon > 0 ? `<img src="https://zephras.com/icons/card/${recipe.icon}.jpg" alt="" width="40" height="40" loading="lazy" referrerpolicy="no-referrer">` : ""}</span>
    <span class="recipe-info"><strong>${escape(recipe.name)}</strong><small>${recipe.itemId ? "Objet fabriqué" : "Recette · " + escape(profession.name)}</small></span><span class="recipe-inspect" aria-hidden="true">✧</span>
  </button></li>`).join("")}</ul>`;
}

function recipeCategory(group, profession) {
  return `<details class="recipe-category" data-recipe-category open><summary><span>${escape(group.name)}</span><span class="recipe-category-count" data-category-count>${group.count}</span></summary>
    ${recipeList(group.recipes, profession)}${group.children.map((child) => recipeCategory(child, profession)).join("")}</details>`;
}

export function professionsPanel(data) {
  if (!data) return `<div id="armory-professions" hidden><h3>Métiers</h3><p class="muted">Métiers non relevés. Installe le collecteur 0.5.19, ouvre chaque métier en jeu, puis lance /cvp export et importe le relevé.</p></div>`;
  return `<div id="armory-professions" hidden>
    <div class="profession-heading"><div><h3>Métiers</h3><p class="muted">Niveaux relevés le ${escape(date(data.at))}.</p></div>
    <label>Rechercher une recette <input type="search" id="recipe-search" placeholder="Nom du craft…"></label></div>
    <p class="muted">Ton grimoire de recettes. Survole un objet ou un enchantement pour consulter sa fiche.</p>
    <div class="profession-list">${data.items.length ? data.items.map((item) => `<section class="profession-card" aria-labelledby="profession-${item.skillLineId}">
      <div class="profession-heading"><h4 id="profession-${item.skillLineId}">${escape(item.name)}</h4><strong>${item.rank} / ${item.maxRank}</strong></div>
      <progress value="${item.rank}" max="${item.maxRank}" aria-label="Niveau de ${escape(item.name)}">${item.rank} / ${item.maxRank}</progress>
      ${item.recipes == null ? '<p class="muted">Recettes non relevées. Ouvre ce métier en jeu pour les récupérer si disponibles.</p>' : `<details class="profession-book" open><summary>${item.recipes.length} recette${item.recipes.length === 1 ? "" : "s"} apprise${item.recipes.length === 1 ? "" : "s"}</summary>
      <p class="muted profession-updated">Relevé le ${escape(date(item.recipesAt))}.</p>
      ${item.recipes.some((recipe) => !recipe.icon) ? '<p class="muted">Pour compléter les icônes et les fiches, ouvre ce métier avec le collecteur à jour, puis réimporte /cvp export.</p>' : ""}
      ${item.recipes.some((recipe) => !recipe.categoryPath?.length) ? '<p class="muted">Pour retrouver les catégories du jeu, ouvre ce métier avec le collecteur 0.5.19, puis réimporte /cvp export.</p>' : ""}
      ${groupRecipes(item.recipes).map((group) => recipeCategory(group, item)).join("")}</details>
      <p class="muted recipe-empty"${item.recipes.length ? " hidden" : ""}>Aucune recette correspondante.</p>`}
    </section>`).join("") : '<p class="muted">Aucun métier appris dans ce relevé.</p>'}</div></div>`;
}

export function bindProfessionSearch(root) {
  const savedOpen = new WeakMap();
  root.querySelector("#recipe-search")?.addEventListener("input", (event) => {
    const query = event.target.value.trim().toLocaleLowerCase("fr");
    for (const card of root.querySelectorAll(".profession-card")) {
      const rows = [...card.querySelectorAll("[data-recipe-name]")];
      for (const row of rows) row.hidden = !row.dataset.recipeName.includes(query);
      for (const group of card.querySelectorAll(".profession-book, [data-recipe-category]")) {
        const matching = [...group.querySelectorAll("[data-recipe-name]")].filter((row) => !row.hidden).length;
        if (group.matches("[data-recipe-category]")) {
          group.hidden = matching === 0;
          group.querySelector("[data-category-count]").textContent = matching;
        }
        if (query) {
          if (!savedOpen.has(group)) savedOpen.set(group, group.open);
          if (matching) group.open = true;
        } else if (savedOpen.has(group)) {
          group.open = savedOpen.get(group);
          savedOpen.delete(group);
        }
      }
      const empty = card.querySelector(".recipe-empty");
      if (empty) empty.hidden = rows.some((row) => !row.hidden);
    }
  });
}
