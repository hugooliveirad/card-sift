import {
  FORMATS,
  DEFAULT_RULES,
  RARITIES,
  norm,
  analyze,
  mergeRows,
  validateRules,
  validQuantity,
  groupKey,
  isExact,
  buildEvidence,
  evidenceFor,
} from "./core.js";
import {
  groupPrintings,
  printingKey,
  ownedVersions,
  finishName,
  isFoil,
  tournamentURL,
  ligaURL,
} from "./display.js";
import {
  COLUMNS,
  parseCSV,
  rowsFromCSV,
  parseDecklist,
  validateBackup,
  atlasBackup,
  csvText,
} from "./import.js";
import { read, write, enrich } from "./data.js";
import { buildArchetypeIndex, archetypesFor } from "./archetypes.js";
import {
  CARD_TYPES,
  compileQuery,
  matchesQuery,
  setMatches,
  typeMatches,
  advancedQuery,
  searchRemote,
} from "./search.js";
const $ = (selector) => document.querySelector(selector);
const e = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const paths = {
  layers: "m12 3 9 5-9 5-9-5 9-5z M3 12l9 5 9-5 M3 16l9 5 9-5",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  help: "M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4 M12 17h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  download: "M12 3v12 m-5-5 5 5 5-5 M4 15v5h16v-5",
  plus: "M12 5v14 M5 12h14",
  upload: "M12 16V4 m-5 5 5-5 5 5 M4 15v5h16v-5",
  arrow: "M4 12h16 m-6-6 6 6-6 6",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3z m-4 9 3 3 5-6",
  check: "m5 12 4 4 10-10",
  box: "m3 7 9-4 9 4v11l-9 4-9-4V7z m0 0 9 5 9-5 M12 12v10 M7 5l10 5",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  refresh: "M20 7v5h-5 M4 17v-5h5 M6 6a8 8 0 0 1 14 6 M4 12a8 8 0 0 0 14 6",
  list: "M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01",
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  search: "M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16 m6-2 5 6",
  external: "M14 3h7v7 M21 3 10 14 M10 3H3v18h18v-7",
  close: "M6 6l12 12 M18 6 6 18",
  chevron: "m9 5 7 7-7 7",
  sliders: "M4 6h16 M4 12h16 M4 18h16 M9 3v6 M15 9v6 M8 15v6",
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.layers}"/></svg>`;
function icons(root = document) {
  root
    .querySelectorAll("[data-icon]")
    .forEach((el) => (el.innerHTML = icon(el.dataset.icon)));
}
function safeURL(value, type = "link") {
  try {
    const u = new URL(value);
    return u.protocol === "https:" &&
      (type === "image"
        ? u.hostname === "cards.scryfall.io"
        : u.hostname === "scryfall.com" || u.hostname === "www.mtgtop8.com")
      ? u.href
      : "";
  } catch {
    return "";
  }
}
const count = (n) => Number(n).toLocaleString();
const date = (value) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "Not loaded";
const money = (value) =>
  value === null
    ? "—"
    : new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: state.rules.currency.toUpperCase(),
      }).format(value);
let state = { rows: [], rules: structuredClone(DEFAULT_RULES) },
  snapshot = null,
  j25 = null,
  archetypes = null,
  archetypeIndex = new Map(),
  example = null,
  results = [],
  previousState = null;
let filter = "all",
  view = "table",
  page = 1,
  query = "",
  color = "",
  rarity = "",
  sort = "name",
  syncController = null,
  busy = false,
  importState = null,
  detailId = null,
  detailPositionId = null,
  toastTimer,
  saveChain = Promise.resolve();
let persistentError = "",
  loadFailed = false,
  ready = false;
let setQuery = "",
  typeInclude = [],
  typeExclude = [],
  compiled = compileQuery(""),
  searchError = "",
  searchController = null,
  searchTimer = null,
  remoteHits = null,
  searchLoading = false;
let detailNavigation = null,
  dialogMode = null,
  modalOpener = null,
  modalOriginId = null,
  pageScroll = null,
  detailScroll = 0;
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 6500);
}
function storageWarning(message) {
  persistentError = message;
  $("#storage-warning").textContent = message;
  $("#storage-warning").hidden = !message;
  $("#save-status").textContent = message
    ? "Not saved. Export a backup."
    : "Collection saved in your browser.";
}
function persist() {
  if (previousState || loadFailed) return Promise.resolve();
  const saved = structuredClone(state);
  $("#save-status").textContent = "Saving changes…";
  saveChain = saveChain
    .then(() => write("state", "collection", saved))
    .then(() => storageWarning(""))
    .catch((err) => storageWarning(err.message));
  return saveChain;
}
function syncRules() {
  const form = $("#rules");
  for (const [key, value] of Object.entries(state.rules)) {
    if (key === "formats") continue;
    const control = form.elements.namedItem(key);
    if (!control) continue;
    if (control.type === "checkbox") control.checked = value;
    else control.value = value;
  }
  form
    .querySelectorAll("[name=formats]")
    .forEach((el) => (el.checked = state.rules.formats.includes(el.value)));
  $("#share-field").hidden = state.rules.formatMode !== "played";
  $("#format-hint").textContent =
    state.rules.formatMode === "played"
      ? "MTGTop8: up to 100 mainboard and 100 sideboard cards, from the last two months."
      : "Any legal or restricted card qualifies, even with no tournament evidence.";
}
function changeRules() {
  const form = $("#rules");
  if (!form.reportValidity()) return;
  const input = new FormData(form);
  const next = { ...state.rules, formats: input.getAll("formats") };
  for (const key of ["copies", "landCopies", "basics", "minShare", "threshold"])
    next[key] = Number(input.get(key));
  for (const key of [
    "formatMode",
    "playsets",
    "rarity",
    "currency",
    "preference",
  ])
    next[key] = input.get(key);
  for (const key of ["priceEnabled", "trustReference", "keepJ25"])
    next[key] = input.has(key);
  try {
    state.rules = validateRules(next);
    page = 1;
    syncRules();
    render();
    persist();
  } catch (err) {
    toast(err.message);
  }
}
function pills(row) {
  return `<div class="allocation">${["keep", "bulk", "review"]
    .filter((key) => row[key])
    .map(
      (key) =>
        `<span class="pill ${key}">${icon(key === "keep" ? "check" : key === "bulk" ? "box" : "eye")}${count(row[key])} ${key === "review" ? "review" : key}</span>`,
    )
    .join("")}</div>`;
}
function reason(row) {
  return row.review
    ? row.uncertainties[0]
    : row.reasons.find((r) => /protected|At or above|chose/.test(r)) ||
        row.reasons[0] ||
        "No keep rule matched";
}
function printing(row) {
  const set = isExact(row) ? row.card.set : row.set;
  const number = isExact(row) ? row.card.collector_number : row.number;
  return `${set ? set.toUpperCase() : "Unspecified set"}${number ? " #" + number : ""} · ${finishName(row.finish)}`;
}
function filteredRows() {
  if (searchError || searchLoading || !compiled) return [];
  return results
    .filter(
      (row) =>
        (filter === "all" || row[filter] > 0) &&
        (compiled.requiresRemote
          ? remoteHits?.has(row.card?.id)
          : matchesQuery(row, compiled)) &&
        setMatches(row, setQuery) &&
        typeMatches(row, typeInclude, typeExclude) &&
        (!rarity || row.card?.rarity === rarity) &&
        (!color ||
          (row.card &&
            (color === "C"
              ? !row.card.colors?.length
              : color === "M"
                ? row.card.colors?.length > 1
                : row.card.colors?.includes(color)))),
    )
    .sort(compareRows);
}
function compareRows(a, b) {
  const diff =
    sort === "played"
      ? (b.tournamentShare ?? -1) - (a.tournamentShare ?? -1)
      : sort === "price"
        ? (b.price ?? -1) - (a.price ?? -1)
        : sort === "quantity"
          ? b.quantity - a.quantity
          : sort === "bulk"
            ? b.bulk - a.bulk
            : sort === "review"
              ? b.review - a.review
              : 0;
  return (
    diff ||
    a.name.localeCompare(b.name) ||
    printing(a).localeCompare(printing(b))
  );
}

function updateSearch() {
  clearTimeout(searchTimer);
  searchController?.abort();
  searchController = null;
  searchError = "";
  remoteHits = null;
  searchLoading = false;
  page = 1;
  try {
    compiled = compileQuery(query);
    if (compiled.requiresRemote) {
      if (compiled.hasCollectionTerms)
        throw new Error(
          "Use the Keep/Bulk/Review tabs with online-only syntax; collection-specific is: terms work with local searches.",
        );
      searchLoading = true;
      const controller = new AbortController();
      searchController = controller;
      searchTimer = setTimeout(async () => {
        try {
          const hits = await searchRemote(query, { signal: controller.signal });
          if (controller.signal.aborted) return;
          remoteHits = hits;
        } catch (error) {
          if (controller.signal.aborted) return;
          searchError =
            error.message + " Edit the query or use locally supported fields.";
        }
        searchLoading = false;
        renderResults();
      }, 400);
    }
  } catch (error) {
    compiled = null;
    searchError = error.message;
  }
  renderResults();
}
function setupFilters() {
  $("#type-options").innerHTML = CARD_TYPES.map(
    (type) =>
      `<label class="field">${type}<select data-type="${type}" aria-label="${type} filter"><option value="">Any</option><option value="include">Include</option><option value="exclude">Exclude</option></select></label>`,
  ).join("");
  const input = (name, label, placeholder = "", type = "text") =>
    `<label class="field">${label}<input name="${name}" type="${type}" placeholder="${e(placeholder)}" ${type === "number" ? 'step="any"' : ""}></label>`;
  const select = (name, label, options) =>
    `<label class="field">${label}<select name="${name}">${options.map(([value, text]) => `<option value="${e(value)}">${e(text)}</option>`).join("")}</select></label>`;
  const checks = (name, label, options) =>
    `<fieldset class="search-checks"><legend>${label}</legend>${options.map(([value, text]) => `<label class="check"><input type="checkbox" name="${name}" value="${value}">${text}</label>`).join("")}</fieldset>`;
  const colors = [
    ["W", "White"],
    ["U", "Blue"],
    ["B", "Black"],
    ["R", "Red"],
    ["G", "Green"],
    ["C", "Colorless"],
  ];
  const operators = [
    ["=", "Equal to"],
    ["<", "Less than"],
    [">", "Greater than"],
    ["<=", "At most"],
    [">=", "At least"],
    ["!=", "Not equal"],
  ];
  $("#advanced-fields").innerHTML = [
    input("name", "Card name", "Lightning"),
    input("oracle", "Rules text", "draw a card · ~ means this card"),
    input("type", "Type line", "creature elf -artifact"),
    input("set", "Set code", "j25"),
    input("mana", "Mana cost (online)", "{G}{U} or 2WW"),
    input("artist", "Artist", "Rebecca Guay"),
    input("flavor", "Flavor text"),
    input("lore", "Lore (online)"),
    input("criteria", "Criteria", "foil reprint -basic"),
    checks("colors", "Card colors", colors),
    select("colorOp", "Color comparison", [
      [":", "Including"],
      ["=", "Exactly"],
      ["<=", "At most"],
    ]),
    checks("identity", "Commander color identity (at most)", colors),
    select("stat", "Statistic", [
      ["mv", "Mana value"],
      ["pow", "Power"],
      ["tou", "Toughness"],
      ["loy", "Loyalty"],
    ]),
    select("statOp", "Stat requirement", operators),
    input("statValue", "Stat value", "3", "number"),
    select("formatStatus", "Format status", [
      ["legal", "Legal or restricted"],
      ["restricted", "Restricted"],
      ["banned", "Banned"],
    ]),
    select("format", "Format", [
      ["", "Any format"],
      ...Object.entries(FORMATS),
    ]),
    select("price", "Price currency", [
      ["usd", "USD"],
      ["eur", "EUR"],
    ]),
    select("priceOp", "Price requirement", operators),
    input("priceValue", "Unit price", "2", "number"),
    checks(
      "rarities",
      "Rarity (any selected)",
      RARITIES.map((r) => [r, r[0].toUpperCase() + r.slice(1)]),
    ),
    checks("games", "Game (any selected)", [
      ["paper", "Paper"],
      ["arena", "Arena"],
      ["mtgo", "Magic Online"],
    ]),
  ].join("");
}
function applyAdvanced() {
  const form = $("#advanced-form");
  if (!form.reportValidity()) return;
  const data = new FormData(form),
    fields = Object.fromEntries(data);
  for (const key of ["colors", "identity", "rarities", "games"])
    fields[key] = data.getAll(key);
  query = advancedQuery(fields);
  $("#search").value = query;
  updateSearch();
}
function showSearchHelp() {
  modal(
    "Search your collection",
    "Atlas-style search, with your sorting plan built in.",
    `<div class="info-copy"><p>Combine terms with spaces (AND), OR, and parentheses. Prefix a term or group with a minus sign to exclude it. The table and grid always show only your imported copies.</p></div><div class="search-examples">${[
      [
        "t:creature -t:artifact c:g mv<=3",
        "Small green creatures, excluding artifacts",
      ],
      ['(t:instant OR t:sorcery) o:"draw a card"', "Card-draw spells"],
      [
        "set:j25",
        "Copies from J25; use is:j25 for deck membership across sets",
      ],
      ["id<=wu f:duel", "Duel Commander cards within white/blue identity"],
      ["r>=rare usd>=2", "Rares and mythics priced at least USD 2"],
      ["is:bulk -t:land", "Bulk copies excluding lands"],
      ["pow>=4", "Power four or greater"],
    ]
      .map(
        ([q, description]) =>
          `<button class="query-example" data-query="${e(q)}"><code>${e(q)}</code><span>${e(description)}</span></button>`,
      )
      .join(
        "",
      )}</div><div class="info-copy"><p>Common type, rules text, mana value, color, identity, stats, rarity, format, set, artist, flavor, price, and sorting terms run locally. Refresh card data if your saved cards lack a field. Unknown metadata does not satisfy a negative filter.</p><p>Other Scryfall syntax (such as lore: or mana-cost comparisons) searches online and intersects returned printing IDs with your collection. Name-only rows use their reference printing. Online errors and overly broad searches are shown explicitly; incomplete results are never presented as complete.</p><p>Set search uses your imported set or a verified printing; it never assumes the reference set is the set you own. <a href="https://scryfall.com/docs/syntax" target="_blank" rel="noopener noreferrer">Full Scryfall syntax</a></p></div>`,
  );
}
function tournamentLabel(row) {
  if (row.tournamentShare === null) return '<span class="muted">—</span>';
  const hit = row.played.find(
    (h) => Math.max(h.mainboard, h.sideboard) === row.tournamentShare,
  );
  return `<span class="number">${row.tournamentShare}%</span><span class="price-note">${e(FORMATS[hit.format])}</span>`;
}

function displayedRows() {
  const rows = filteredRows();
  return view === "table" ? groupPrintings(rows).sort(compareRows) : rows;
}
function finishSummary(row) {
  return row.versions
    .map((v) => `${count(v.quantity)} ${finishName(v.finish)}`)
    .join(" · ");
}
function finishPrices(row) {
  return row.versions
    .map(
      (v) =>
        `<span class="finish-price">${money(v.price)} <small>${e(finishName(v.finish))}${v.price !== null && !v.exact ? " · ref." : ""}</small></span>`,
    )
    .join("");
}
function formatMatrix(row) {
  const evidence = buildEvidence(snapshot);
  return `<div class="format-matrix">${Object.entries(FORMATS)
    .map(([format, label]) => {
      const status = row.card?.legalities?.[format] || "unknown";
      const playable = ["legal", "restricted"].includes(status);
      const hit = evidenceFor(row, format, evidence);
      const statusLabel = status.replaceAll("_", " ");
      const usage = hit
        ? `Mainboard ${hit.mainboard}%${snapshot.formats[format].sections?.includes("sideboard") === false ? "" : ` · Sideboard ${hit.sideboard}%`}`
        : "";
      return `<div class="format-tag ${playable ? "is-legal" : ""}"><span class="format-name"><i class="legality-dot" aria-hidden="true"></i>${e(label)}</span><span class="format-status">${e(statusLabel)}</span>${hit ? `<a class="format-share" href="${e(safeURL(snapshot.formats[format].url))}" target="_blank" rel="noopener noreferrer" title="${e(usage)}"><strong>${Math.max(hit.mainboard, hit.sideboard)}%</strong> of decks<span class="sr-only"> · ${e(usage)} · ${e(label)} source</span></a>` : `<span class="format-share muted">${snapshot?.formats?.[format] ? "No sampled play" : "No usage data"}</span>`}</div>`;
    })
    .join("")}</div>`;
}

function cardLinks(row, menu = false) {
  const name = row.card?.name || row.name;
  const set = isExact(row) ? row.card.set : row.set;
  const number = isExact(row) ? row.card.collector_number : row.number;
  const exactLink = isExact(row) ? safeURL(row.card?.scryfall_uri) : "";
  const printingLink =
    exactLink ||
    (set && number
      ? `https://scryfall.com/card/${encodeURIComponent(set)}/${encodeURIComponent(number)}`
      : "");
  const links = [
    ...(printingLink
      ? [
          [
            exactLink
              ? "Scryfall · this printing"
              : "Scryfall · look up printing",
            printingLink,
          ],
        ]
      : [
          [
            "Scryfall · card search",
            "https://scryfall.com/search?" +
              new URLSearchParams({ q: `!"${name.replaceAll('"', "")}"` }),
          ],
        ]),
    ...(set
      ? [
          [
            `Scryfall · ${set.toUpperCase()} set`,
            `https://scryfall.com/sets/${encodeURIComponent(set)}`,
          ],
        ]
      : []),
    ["LigaMagic · card prices", ligaURL(name)],
    ["MTGTop8 · tournament decks", tournamentURL(name)],
  ];
  const body = links
    .map(
      ([label, url]) =>
        `<a href="${e(url)}" target="_blank" rel="noopener noreferrer">${e(label)} ${icon("external")}</a>`,
    )
    .join("");
  return menu
    ? `<details class="links-menu" name="version-links"><summary aria-label="Links for ${e(printing(row))}">Links</summary><div>${body}</div></details>`
    : `<div class="card-links">${body}</div>`;
}

function deckMembership(row) {
  const name = row.card?.name || row.name;
  const key = Object.keys(j25?.membership || {}).find(
    (key) => norm(key) === norm(name),
  );
  const memberships = j25?.membership?.[key] || [];
  return `<section class="detail-section"><h3>Decks using this card</h3><h4>Foundations Jumpstart · J25</h4>${
    memberships.length
      ? `<p class="hint">${memberships.length} deck variants · matches every printing of this card.</p><div class="deck-memberships">${memberships
          .map(({ deck, quantity }) => {
            const info = j25.deckInfo[deck];
            return `<a href="https://hugobessa.com.br/jumpstart-atlas/#explore?pack=${encodeURIComponent(deck)}" target="_blank" rel="noopener noreferrer"><span>${e(info.name)} <small>v${info.variant}</small></span><span>${quantity}× ${icon("external")}</span></a>`;
          })
          .join("")}</div>`
      : `<p class="hint">${j25?.membership ? "Not in the J25 deck catalog." : "Deck membership data is unavailable. Reload to retry."}</p>`
  }${archetypesHTML(row)}<h4>More tournament decklists</h4><div class="tournament-decks">${Object.entries(
    FORMATS,
  )
    .filter(
      ([format]) =>
        snapshot?.formats?.[format] &&
        ["legal", "restricted"].includes(row.card?.legalities?.[format]),
    )
    .map(
      ([format, label]) =>
        `<a href="${e(tournamentURL(name, format))}" target="_blank" rel="noopener noreferrer">${e(label)} ${icon("external")}</a>`,
    )
    .join(
      "",
    )}<a href="${e(tournamentURL(name))}" target="_blank" rel="noopener noreferrer">All tournament decks ${icon("external")}</a></div></section>`;
}

function archetypesHTML(row) {
  if (!archetypes)
    return '<h4>Tournament archetypes</h4><p class="hint">Archetype evidence is unavailable. Reload to retry, or use the decklist searches below.</p>';
  const groups = archetypesFor(row, archetypeIndex);
  const stale = Date.now() - Date.parse(archetypes.fetchedAt) > 35 * 86400000;
  return `<h4>Tournament archetypes</h4><p class="hint">Observed in up to ${archetypes.maxDecksPerFormat} recent lists per format, within ${date(archetypes.from + "T12:00:00Z")}–${date(archetypes.through + "T12:00:00Z")}. Refreshed ${date(archetypes.fetchedAt)}.${stale ? " This sample is over 35 days old." : ""} These examples do not measure archetype popularity or affect your keep rules.</p>${
    groups.length
      ? `<div class="archetype-formats">${Object.entries(FORMATS)
          .map(([format, label]) => {
            const matches = groups.filter((group) => group.format === format);
            if (!matches.length) return "";
            const status = row.card?.legalities?.[format];
            return `<section class="archetype-format"><h5>${e(label)} <span>${archetypes.formats[format].decks.length} lists sampled${status && !["legal", "restricted"].includes(status) ? ` · currently ${e(status.replaceAll("_", " "))}` : ""}</span></h5>${matches
              .map((group) => {
                const main = group.matches.filter(
                  (hit) => hit.mainboard > 0,
                ).length;
                const side = group.matches.filter(
                  (hit) => hit.sideboard > 0,
                ).length;
                const commanders = group.matches.filter(
                  (hit) => hit.commander > 0,
                ).length;
                return `<details class="archetype-card"><summary><span><strong>${e(group.name)}</strong><small>${group.matches.length} matching ${group.matches.length === 1 ? "list" : "lists"} · ${[main ? `mainboard in ${main}` : "", side ? `sideboard in ${side}` : "", commanders ? `commander in ${commanders}` : ""].filter(Boolean).join(" · ")}</small></span></summary><div class="archetype-evidence"><a class="archetype-source" href="${e(safeURL(group.url))}" target="_blank" rel="noopener noreferrer">${e(group.name)} on MTGTop8 ${icon("external")}</a>${group.matches.map(({ deck, mainboard, sideboard, commander }) => `<a class="archetype-deck" href="${e(safeURL(deck.url))}" target="_blank" rel="noopener noreferrer"><strong>${e(deck.name)} ${icon("external")}</strong><span>${e(deck.event)} · ${date(deck.playedAt + "T12:00:00Z")}</span><small>${[mainboard ? `${mainboard} mainboard` : "", sideboard ? `${sideboard} sideboard` : "", commander ? `${commander} commander` : ""].filter(Boolean).join(" · ")}</small></a>`).join("")}</div></details>`;
              })
              .join("")}</section>`;
          })
          .join("")}</div>`
      : '<p class="hint">No matching card in this recent decklist sample. This does not mean the card sees no tournament play.</p>'
  }`;
}

function versionsHTML(row) {
  const versions = ownedVersions(row, results);
  return `<section class="detail-section"><h3>Versions you own <span class="muted">· ${count(versions.reduce((sum, v) => sum + v.quantity, 0))} copies</span></h3><p class="hint">All owned sets and finishes, including those outside the current filters. Select a version to inspect or edit its copies.</p><div class="owned-versions">${versions.map((v) => `<div class="owned-version ${v.id === row.id ? "selected" : ""}"><button class="version-select" id="version-${e(v.id)}" data-version="${e(v.id)}" aria-pressed="${v.id === row.id}"><span class="thumb ${isFoil(v) ? "foil-image" : ""}">${safeURL(v.card?.art, "image") ? `<img src="${e(safeURL(v.card.art, "image"))}" loading="lazy" alt="">` : icon("layers")}</span><span><strong>${e(printing(v))}</strong><small>${e(v.set && v.set === v.card?.set ? v.card.set_name : v.exact ? v.card?.set_name : "Printing not verified")}</small><small>${count(v.quantity)} owned · ${money(v.price)} each${!v.exact ? " · reference" : ""}</small></span></button><div class="version-plan">${pills(v)}</div>${cardLinks(v, true)}</div>`).join("")}</div></section>`;
}

function render() {
  results = analyze(state.rows, state.rules, snapshot, Date.now(), j25);
  const sets = new Map();
  for (const row of state.rows) {
    const code = row.set || (isExact(row) ? row.card?.set : "");
    if (code) sets.set(code, row.card?.set === code ? row.card.set_name : code);
  }
  $("#owned-sets").innerHTML = [...sets]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([code, name]) =>
        `<option value="${e(code.toUpperCase())}">${e(name)}</option>`,
    )
    .join("");
  const totals = results.reduce(
    (s, r) => {
      for (const k of ["quantity", "keep", "bulk", "review"]) s[k] += r[k];
      return s;
    },
    { quantity: 0, keep: 0, bulk: 0, review: 0 },
  );
  $("#stat-total").textContent = count(totals.quantity);
  $("#nav-count").textContent = count(totals.quantity);
  for (const key of ["keep", "bulk", "review"]) {
    $("#stat-" + key).textContent = count(totals[key]);
    $("#tab-" + key).textContent = count(totals[key]);
  }
  $("#stat-distinct").textContent = state.rows.length
    ? `${count(new Set(state.rows.map(groupKey)).size)} card names · ${count(new Set(state.rows.map(printingKey)).size)} printings`
    : "Your cards, all in one place";
  $("#row-count").textContent =
    count(new Set(state.rows.map(printingKey)).size) + " printings";
  $("#welcome").hidden = state.rows.length > 0;
  $("#demo-notice").hidden = !previousState;
  $("#collection-status").textContent = previousState
    ? "Example collection"
    : state.rows.length
      ? "Saved on this device"
      : "Ready for your collection";
  $("#collection-subtitle").textContent = state.rows.length
    ? `${state.rules.formatMode === "played" ? "Tournament evidence" : "Format legality"} · ${state.rules.copies} copies per playset · Prices in ${state.rules.currency.toUpperCase()}`
    : "A clear reason behind every decision.";
  $("#sync-button").disabled =
    busy || !state.rows.length || Boolean(previousState);
  document
    .querySelectorAll("[data-action=import]")
    .forEach((b) => (b.disabled = busy || loadFailed || !ready));
  document
    .querySelectorAll("[data-filter]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", b.dataset.filter === filter),
    );
  document
    .querySelectorAll("[data-view]")
    .forEach((b) => b.setAttribute("aria-pressed", b.dataset.view === view));
  renderResults();
}
function renderResults() {
  const message =
    searchError ||
    (searchLoading
      ? "Searching Scryfall… results will appear when the complete search finishes."
      : compiled?.requiresRemote
        ? "Scryfall results matched to collection printing IDs."
        : query
          ? "Local advanced search · refresh card data if fields are missing."
          : "");
  $("#search-status").textContent = message;
  $("#search-status").hidden = !message;
  $("#search-status").classList.toggle("error-copy", Boolean(searchError));
  $("#type-filter-count").textContent =
    typeInclude.length + typeExclude.length
      ? `(${typeInclude.length + typeExclude.length} active)`
      : "";

  const rows = displayedRows();
  const pages = Math.max(1, Math.ceil(rows.length / 48));
  page = Math.min(page, pages);
  const visible = rows.slice((page - 1) * 48, page * 48);
  if (!state.rows.length) {
    $("#results").innerHTML =
      `<div class="empty"><div class="empty-icon">${icon("layers")}</div><h3>Good cards deserve to be found.</h3><p>Import your collection to see what to keep, what to box up, and what needs a closer look.</p><div class="row wrap"><button class="button primary small" data-action="import">${icon("upload")} Import cards</button><button class="text-button" data-action="demo">Try an example ${icon("arrow")}</button></div></div>`;
  } else if (!rows.length) {
    $("#results").innerHTML =
      `<div class="empty"><div class="empty-icon">${icon("search")}</div><h3>${searchLoading ? "Searching your collection…" : searchError ? "Check your search" : "No cards match this view."}</h3><p>${e(searchError || (searchLoading ? "Waiting for the full Scryfall result." : "Try another search or clear the filters to see your collection."))}</p><button class="button quiet small" data-action="clear-filters">Clear filters</button></div>`;
  } else if (view === "table") {
    $("#results").innerHTML =
      `<div class="table-wrap" tabindex="0" role="region" aria-label="Collection table, scroll horizontally for all columns"><table><thead><tr><th scope="col">Card / printing</th><th scope="col">Rarity</th><th scope="col">Owned</th><th scope="col">Unit price</th><th scope="col" title="Highest mainboard or sideboard share in selected formats">Tournament play</th><th scope="col">Sorting plan</th><th scope="col">Why</th><th scope="col"><span class="sr-only">Details</span></th></tr></thead><tbody>${visible.map((row) => `<tr><td><button class="card-cell" data-detail="${e(row.id)}"><span class="thumb ${row.versions.some(isFoil) ? "foil-image" : ""}">${safeURL(row.card?.art, "image") ? `<img src="${e(safeURL(row.card.art, "image"))}" alt="" loading="lazy">` : icon("layers")}</span><span><strong>${e(row.name)}</strong><small>${e(printing(row).replace(/ · (Nonfoil|Foil|Etched foil)$/, ""))}</small><small>${e(finishSummary(row))}</small></span></button></td><td><span class="rarity ${e(row.card?.rarity || "")}">${e(row.card?.rarity || "Unknown")}</span></td><td class="number">${count(row.quantity)}</td><td class="number">${finishPrices(row)}</td><td>${tournamentLabel(row)}</td><td>${pills(row)}</td><td class="reason-cell">${row.versions.length > 1 ? "Decisions by finish · open details" : e(reason(row))}</td><td><button class="more-button" data-detail="${e(row.id)}" aria-label="Details for ${e(row.name)}">${icon("chevron")}</button></td></tr>`).join("")}</tbody></table></div>`;
  } else {
    $("#results").innerHTML =
      `<div class="card-grid">${visible.map((row) => `<article class="grid-card"><button class="grid-image ${isFoil(row) ? "foil-image" : ""}" data-detail="${e(row.id)}" aria-label="Details for ${e(row.name)}">${safeURL(row.card?.image, "image") ? `<img src="${e(safeURL(row.card.image, "image"))}" alt="${e(row.name)}" loading="lazy" width="488" height="680">` : '<span class="image-placeholder">◈</span>'}<span class="grid-qty">${count(row.quantity)} owned</span>${isFoil(row) ? `<span class="foil-label">✦ ${e(finishName(row.finish))}</span>` : ""}</button><div class="grid-body"><button class="grid-name" data-detail="${e(row.id)}">${e(row.name)}</button><div class="grid-meta"><span>${e(printing(row))}</span><span class="number">${money(row.price)}${row.price !== null && !row.exact ? " ref." : ""}</span></div>${pills(row)}<div class="grid-played">${tournamentLabel(row)}</div><details class="grid-formats"><summary>Formats &amp; tournament use</summary>${formatMatrix(row)}</details><p class="grid-reason">${e(reason(row))}</p></div></article>`).join("")}</div>`;
  }
  $("#pagination").innerHTML = rows.length
    ? `<span>${count((page - 1) * 48 + 1)}–${count(Math.min(page * 48, rows.length))} of ${count(rows.length)} ${view === "table" ? "printings" : "printing / finish entries"}</span><div class="row"><button class="button quiet small" data-page="${page - 1}" ${page === 1 ? "disabled" : ""}>Previous</button><span>${page} / ${pages}</span><button class="button quiet small" data-page="${page + 1}" ${page === pages ? "disabled" : ""}>Next</button></div>`
    : "";
}
function modal(title, subtitle, body, footer = "", options = {}) {
  const dialog = $("#dialog"),
    wasOpen = dialog.open,
    active = document.activeElement;
  const focusId = dialog.contains(active) ? active?.id : null;
  const focusAction = dialog.contains(active) ? active?.dataset.action : null;
  const scroll = options.preserve ? dialog.scrollTop : options.scrollTop || 0;
  if (!wasOpen) {
    modalOpener = active;
    modalOriginId = active?.dataset.detail;
    pageScroll = { x: window.scrollX, y: window.scrollY };
  }
  dialogMode = options.kind || "other";
  $("#dialog-content").innerHTML =
    `<div class="dialog-header"><div><h2 id="dialog-title">${e(title)}</h2>${subtitle ? `<p>${e(subtitle)}</p>` : ""}</div><button class="close-button" data-action="close" aria-label="Close dialog">${icon("close")}</button></div><div class="dialog-body">${body}</div>${footer ? `<div class="dialog-footer">${footer}</div>` : ""}`;
  dialog.setAttribute("aria-labelledby", "dialog-title");
  if (!wasOpen) dialog.showModal();
  else {
    const focus = focusId
      ? dialog.querySelector("#" + CSS.escape(focusId))
      : focusAction
        ? dialog.querySelector(
            `[data-action="${CSS.escape(focusAction)}"]:not(:disabled)`,
          )
        : null;
    (focus || dialog.querySelector(".close-button")).focus({
      preventScroll: true,
    });
  }
  dialog.scrollTop = scroll;
}
function closeModal() {
  $("#dialog").close();
}
function restoreModalOrigin() {
  const target = modalOpener?.isConnected
    ? modalOpener
    : modalOriginId
      ? document.querySelector(`[data-detail="${CSS.escape(modalOriginId)}"]`)
      : null;
  (target || $("#collection")).focus({ preventScroll: true });
  if (pageScroll)
    window.scrollTo({
      left: pageScroll.x,
      top: pageScroll.y,
      behavior: "instant",
    });
  detailId = null;
  detailPositionId = null;
  detailNavigation = null;
  dialogMode = null;
  modalOpener = null;
  modalOriginId = null;
  pageScroll = null;
}
function detailNavHTML() {
  const index = detailNavigation?.indexOf(detailPositionId) ?? -1,
    total = detailNavigation?.length || 0;
  return `<nav class="dialog-nav" aria-label="Navigate filtered collection"><button class="button quiet small" data-action="previous-card" ${index <= 0 ? "disabled" : ""}>Previous</button><span class="dialog-position" role="status" aria-live="polite">${index + 1} / ${total}<small>Filtered collection · ← / →</small></span><button class="button quiet small" data-action="next-card" ${index >= total - 1 ? "disabled" : ""}>Next</button></nav>`;
}
function stepCard(direction) {
  const index = detailNavigation?.indexOf(detailPositionId) ?? -1;
  const next = detailNavigation?.[index + direction];
  if (next) showDetail(next, { navigation: true });
}
function backToCard() {
  showDetail(detailId, { scrollTop: detailScroll });
}

function download(name, text, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function backup() {
  download(
    "card-sift-backup-" + new Date().toISOString().slice(0, 10) + ".json",
    JSON.stringify(
      {
        app: "card-sift",
        schema: 1,
        exportedAt: new Date().toISOString(),
        rules: state.rules,
        rows: state.rows.map(({ card, fetchedAt, lookupError, ...row }) => row),
      },
      null,
      2,
    ),
    "application/json",
  );
  toast("Backup downloaded with your collection, rules, and manual decisions.");
}
async function sync(force = false) {
  if (busy || !state.rows.length || previousState || !ready) return;
  busy = true;
  syncController = new AbortController();
  render();
  $("#sync-status").hidden = false;
  try {
    const done = await enrich(state.rows, {
      force,
      signal: syncController.signal,
      onProgress: ({ completed, total, unmatched }) => {
        $("#sync-status").innerHTML =
          `Looking up card details: ${count(completed)} / ${count(total)} printings${unmatched ? ` · ${unmatched} need a corrected identifier` : ""}<button class="text-button" data-action="cancel-sync">Stop lookup</button>`;
        render();
        persist();
      },
    });
    $("#sync-status").textContent =
      `Card lookup complete. ${done.unmatched ? done.unmatched + " unmatched printings need review." : "Prices and legalities updated."}`;
  } catch (err) {
    $("#sync-status").textContent =
      err.name === "AbortError"
        ? "Lookup stopped. Imported copies are saved; refresh to continue."
        : err.message;
  } finally {
    busy = false;
    syncController = null;
    await persist();
    render();
  }
}
function openImport() {
  if (loadFailed) {
    toast("Reload to recover browser storage before importing.");
    return;
  }
  if (busy) {
    toast("Wait for card lookup to finish or stop it first.");
    return;
  }
  if (previousState) exitDemo();
  importState = { mode: "replace", ack: false, fileName: "Pasted decklist" };
  renderImport();
}
function renderImport() {
  const m = importState;
  if (!m.result && !m.parsed) {
    modal(
      "Bring your collection along",
      "Choose an export, or paste a decklist. You’ll review the import before it changes anything.",
      `
      <label class="drop-zone" id="drop-zone">${icon("upload")}<strong>Drop your collection here</strong><span>CSV, TSV, TXT, or JSON · up to 20 MB</span><input type="file" id="collection-file" accept=".csv,.tsv,.txt,.json" aria-label="Choose collection file"></label>
      <p class="hint">Works with common ManaBox, Moxfield, and Mythic Tools CSV columns. Set code, collector number, and finish give the most accurate prices. Column mapping is adjustable.</p>
      ${m.error ? `<p class="error-copy" role="alert">${e(m.error)}</p>` : ""}<div class="import-or">or paste a decklist</div><label class="sr-only" for="decklist">Card decklist</label><textarea id="decklist" placeholder="8 Lightning Bolt (M11) 149&#10;4 Counterspell&#10;2 Sol Ring"></textarea><div class="row between wrap"><button class="text-button" data-action="template">${icon("download")} CSV template</button><button class="button quiet small" data-action="preview-paste">Preview decklist ${icon("arrow")}</button></div>
      <p class="hint">Files are read in this browser. Card identifiers are sent to Scryfall for card details; quantities and your keep rules stay on this device. JSON backups from Card Sift and Jumpstart Atlas are supported.</p>`,
    );
    return;
  }
  const result = m.result;
  const total = result?.rows.reduce((sum, r) => sum + r.quantity, 0) || 0;
  const mapping = m.parsed
    ? `<details class="native-details" ${m.error ? "open" : ""}><summary>Review column mapping</summary><div class="import-mapping">${Object.entries(
        COLUMNS,
      )
        .map(
          ([key, label]) =>
            `<label class="field">${label}<select data-mapping="${key}"><option value="-1">${key === "quantity" ? "Assume 1" : key === "finish" ? "Assume nonfoil" : "Not mapped"}</option>${m.parsed.headers.map((header, i) => `<option value="${i}" ${m.parsed.mapping[key] === i ? "selected" : ""}>${e(header || "Column " + (i + 1))}</option>`).join("")}</select></label>`,
        )
        .join("")}</div></details>`
    : "";
  modal(
    "Check your import",
    m.fileName,
    `${mapping}${m.error ? `<p class="error-copy" role="alert">${e(m.error)}</p>` : ""}${
      result
        ? `
    <div class="import-summary"><div><strong>${count(total)}</strong><small>Card copies</small></div><div><strong>${count(result.rows.length)}</strong><small>Printing rows</small></div><div><strong>${count(result.issues.length)}</strong><small>Import issues</small></div></div>
    <div class="table-wrap"><table><thead><tr><th>Card</th><th>Qty</th><th>Printing</th></tr></thead><tbody>${result.rows
      .slice(0, 5)
      .map(
        (row) =>
          `<tr><td>${e(row.name)}</td><td>${count(row.quantity)}</td><td>${e(printing(row))}</td></tr>`,
      )
      .join(
        "",
      )}</tbody></table></div>${result.rows.length > 5 ? `<p class="hint">Showing 5 of ${count(result.rows.length)} printing rows.</p>` : ""}
    <label class="radio-option"><input type="radio" name="import-mode" value="replace" ${m.mode === "replace" ? "checked" : ""}><span>Replace collection${state.rows.length ? ` (${count(state.rows.reduce((s, r) => s + r.quantity, 0))} existing copies)` : ""}<small>Use a full inventory export. The previous collection will be available to undo until you leave this page.</small></span></label>
    ${!m.backup ? `<label class="radio-option"><input type="radio" name="import-mode" value="add" ${m.mode === "add" ? "checked" : ""}><span>Add these copies<small>Use for new cards. Importing the same file twice adds its quantities twice.</small></span></label>` : '<p class="notice">This backup will also restore its keep rules and manual decisions.</p>'}
    ${
      result.issues.length
        ? `<details class="native-details" open><summary>${result.issues.length} rows could not be read</summary><ul class="issue-list">${result.issues
            .slice(0, 30)
            .map(
              (issue) =>
                `<li>Row ${issue.row} · ${e(issue.name || "Unnamed")}<br>${e(issue.message)}</li>`,
            )
            .join(
              "",
            )}</ul><button class="text-button" data-action="issues">Download all issues</button><label class="check"><input id="ack-issues" type="checkbox" ${m.ack ? "checked" : ""}> I reviewed the issues. Import only the valid rows.</label></details>`
        : ""
    }
    <p class="hint">Card lookups run after import. Unknown cards stay in Needs review until corrected.</p>`
        : ""
    }`,
    `<button class="button quiet" data-action="import">Choose another file</button><button class="button primary" data-action="commit-import" ${!result?.rows.length || (result?.issues.length && !m.ack) ? "disabled" : ""}>${m.mode === "add" ? "Add cards" : "Import collection"}</button>`,
  );
}
function recalcImport() {
  try {
    importState.result = rowsFromCSV(importState.parsed);
    importState.error = "";
  } catch (err) {
    importState.result = null;
    importState.error = err.message;
  }
  renderImport();
}
async function readFile(file) {
  if (!file) return;
  try {
    if (file.size > 20 * 1024 * 1024)
      throw new Error("Choose a file smaller than 20 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const encoding =
      bytes[0] === 255 && bytes[1] === 254
        ? "utf-16le"
        : bytes[0] === 254 && bytes[1] === 255
          ? "utf-16be"
          : "utf-8";
    const text = new TextDecoder(encoding, { fatal: true })
      .decode(bytes)
      .replace(/^\uFEFF/, "");
    importState = { mode: "replace", ack: false, fileName: file.name };
    if (/\.json$/i.test(file.name)) {
      const input = JSON.parse(text);
      if (input.app === "card-sift") {
        importState.backup = validateBackup(input);
        importState.result = { rows: importState.backup.rows, issues: [] };
      } else importState.result = atlasBackup(input);
    } else if (/\.txt$/i.test(file.name))
      importState.result = parseDecklist(text);
    else {
      importState.parsed = parseCSV(text);
      recalcImport();
      return;
    }
    renderImport();
  } catch (err) {
    importState.error = err.message;
    renderImport();
  }
}
let undoState = null;
async function commitImport() {
  const m = importState;
  if (!m?.result?.rows.length || (m.result.issues.length && !m.ack) || busy)
    return;
  try {
    const rows =
      m.mode === "add" ? mergeRows(state.rows, m.result.rows) : m.result.rows;
    undoState = structuredClone(state);
    state = { rows, rules: m.backup?.rules || state.rules };
    page = 1;
    filter = "all";
    closeModal();
    syncRules();
    render();
    await persist();
    $("#sync-status").hidden = false;
    await sync();
    $("#sync-status").insertAdjacentHTML(
      "beforeend",
      ' <button class="text-button" data-action="undo-import">Undo last import</button>',
    );
    toast(
      `${count(rows.reduce((s, r) => s + r.quantity, 0))} copies in your collection.`,
    );
  } catch (err) {
    m.error = err.message;
    renderImport();
  }
}
async function loadExample() {
  if (busy) return;
  if (!example) {
    toast(
      "Example data could not load. Refresh the page or import your own cards.",
    );
    return;
  }
  if (!previousState) previousState = structuredClone(state);
  state = {
    rows: structuredClone(example.rows),
    rules: structuredClone(DEFAULT_RULES),
  };
  filter = "all";
  page = 1;
  syncRules();
  render();
  $("#sync-status").hidden = true;
}
function exitDemo() {
  if (!previousState) return;
  state = previousState;
  previousState = null;
  filter = "all";
  page = 1;
  syncRules();
  render();
}
function showDetail(id, options = {}) {
  if (!$("#dialog").open || !detailNavigation) {
    detailNavigation = displayedRows().map((row) => row.id);
    if (!detailNavigation.includes(id)) detailNavigation.push(id);
    detailPositionId = id;
  } else if (options.navigation && detailNavigation.includes(id)) {
    detailPositionId = id;
  }
  detailId = id;
  const row = results.find((r) => r.id === id);
  if (!row) return;
  const c = row.card,
    img = safeURL(c?.image, "image");
  modal(
    row.name,
    printing(row),
    `<div class="detail-layout"><div><div class="detail-art ${isFoil(row) ? "foil-image" : ""}">${img ? `<img class="detail-image" src="${e(img)}" alt="${e(row.name)}">` : '<div class="no-image">Card image unavailable</div>'}${isFoil(row) ? `<span class="foil-label">✦ ${e(finishName(row.finish))}</span>` : ""}</div><div class="detail-price">${money(row.price)}</div><p class="hint">${row.exact ? "Exact printing" : "Reference printing"} · ${e(finishName(row.finish))}<br>${c ? `Scryfall price · ${date(row.fetchedAt)}` : "Refresh card data to look up this card."}</p>${cardLinks(row)}</div><div><div class="detail-meta">${e(c?.type_line || "Card details unavailable")}<br>${e(c?.mana_cost || "")} ${c ? " · " + e(c.rarity) : ""} · ${count(row.quantity)} owned in this finish</div>${pills(row)}<h3>Why these copies go here</h3><ul class="detail-reasons">${[...new Set(row.reasons)].map((reason) => `<li>${e(reason)}</li>`).join("")}${row.review ? row.uncertainties.map((reason) => `<li>${e(reason)}</li>`).join("") : ""}</ul>
    <h3>Formats &amp; tournament use</h3>${formatMatrix(row)}<p class="hint">Green: legal or restricted · gray: not legal or unknown. Status is also written on each tag.</p><p class="hint">Usage is the higher of mainboard / sideboard deck share; sections are never added. ${snapshot ? `MTGTop8 · ${e(snapshot.window)} · fetched ${date(snapshot.fetchedAt)}.` : "Tournament data unavailable."} No sampled play does not mean 0%. All formats are shown, independently of your keep rules.</p>
    <h3>Your decision</h3><label class="field">Override for this printing and finish<select id="row-override"><option value="" ${!row.override ? "selected" : ""}>Follow my keep rules</option><option value="keep" ${row.override === "keep" ? "selected" : ""}>Keep every copy</option><option value="bulk" ${row.override === "bulk" ? "selected" : ""}>Put every copy in bulk</option></select></label><div class="detail-actions"><button class="button quiet small" data-action="edit-card">Edit card / quantity</button><button class="button quiet small" data-action="copy-card">Copy decklist line</button></div></div></div>
    ${versionsHTML(row)}${deckMembership(row)}
    ${c ? `<details class="native-details"><summary>Card text</summary><p class="oracle-text" style="margin:15px 0">${e(c.oracle_text)}</p></details>` : ""}`,
    detailNavHTML(),
    { kind: "card", ...options },
  );
}

function editCard() {
  detailScroll = $("#dialog").scrollTop;
  const row = state.rows.find((r) => r.id === detailId);
  if (!row) return;
  modal(
    "Edit card",
    "Correct an identifier or update how many copies you own.",
    `<form id="edit-form"><div class="edit-fields"><label class="field wide">English card name<input name="name" required maxlength="300" value="${e(row.name)}"></label><label class="field">Quantity<input name="quantity" type="number" min="1" max="100000" step="1" required value="${row.quantity}"></label><label class="field">Finish<select name="finish">${["nonfoil", "foil", "etched"].map((f) => `<option ${f === row.finish ? "selected" : ""}>${f}</option>`).join("")}</select></label><label class="field">Set code<input name="set" value="${e(row.set)}"></label><label class="field">Collector number<input name="number" value="${e(row.number)}"></label><label class="field wide">Scryfall ID (optional, overrides name and set)<input name="scryfallId" value="${e(row.scryfallId)}" pattern="[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}"></label></div><p class="hint">To switch cards or printings, clear the old Scryfall ID first. Card details will be fetched again after saving.</p></form>`,
    `<button class="button quiet" data-action="back-card">Back to card</button><button class="button primary" data-action="save-card">Save changes</button>`,
    { kind: "edit" },
  );
}
async function saveCard() {
  if (busy) {
    toast("Stop the current lookup before editing card identifiers.");
    return;
  }
  const form = $("#edit-form");
  if (!form.reportValidity()) return;
  const old = state.rows.find((r) => r.id === detailId);
  const fields = Object.fromEntries(new FormData(form));
  fields.quantity = Number(fields.quantity);
  fields.set = fields.set.trim().toLowerCase();
  for (const key of ["name", "number", "scryfallId"])
    fields[key] = fields[key].trim();
  if (!fields.name || !validQuantity(fields.quantity)) return;
  Object.assign(old, fields);
  delete old.card;
  delete old.fetchedAt;
  delete old.lookupError;
  const id = detailId;
  render();
  showDetail(id, { scrollTop: detailScroll });
  await persist();
  if (!previousState) await sync();
  if ($("#dialog").open && dialogMode === "card" && detailId === id)
    showDetail(id, { preserve: true });
}
function showSources() {
  const old =
    !snapshot || Date.now() - Date.parse(snapshot.fetchedAt) > 35 * 86400000;
  modal(
    "Where the recommendations come from",
    "Facts, dates, and the limits of each source.",
    `<div class="info-copy"><h3>Tournament play · MTGTop8</h3><p>A dated snapshot of the ${snapshot?.window?.toLowerCase() || "last two months"} of tournament deck statistics. We include up to 100 mainboard and 100 sideboard cards per format, each appearing in at least 1% of decks in that section. Basic lands are excluded from this sample and use your separate reserve. Duel Commander uses mainboard evidence only.</p><p><strong>Absence from this sample does not mean a card never sees play.</strong> Your selected minimum share is checked against either section. A card must also be currently legal or restricted according to Scryfall to qualify.</p><p>Snapshot fetched: <strong>${date(snapshot?.fetchedAt)}</strong>. The hosted site refreshes weekly. ${old ? "Missing or old evidence sends uncertain copies to Needs review." : "The snapshot is current. Tournament sorting uses the highest section percentage among your selected formats; percentages are never added across formats."}</p></div>
    ${Object.entries(FORMATS)
      .map(
        ([format, label]) =>
          `<div class="source-row"><div>${label}<small>${snapshot?.formats?.[format] ? count(snapshot.formats[format].cards.length) + " sampled card names" : "No tournament source bundled · legality mode available"}</small></div>${snapshot?.formats?.[format] ? `<a href="${e(safeURL(snapshot.formats[format].url))}" target="_blank" rel="noopener noreferrer">View MTGTop8 ${icon("external")}</a>` : ""}</div>`,
      )
      .join("")}
    <div class="info-copy" style="margin-top:24px"><h3>Tournament archetypes · MTGTop8</h3><p>Up to 25 recent decklists per format from the preceding 60 days, labeled with MTGTop8’s archetype names. Card details show matching lists, section-specific copy counts, dates, and event links. This sample provides examples of use; it does not measure archetype popularity or change your keep rules. ${archetypes ? `Snapshot fetched: ${date(archetypes.fetchedAt)}.` : "Archetype data unavailable; reload to retry."}</p></div>
    <div class="info-copy" style="margin-top:24px"><h3>J25 deck membership · Jumpstart Atlas</h3><p>${j25 ? `${j25.names.length} unique English card names from ${j25.decks} Foundations Jumpstart decks. Updated ${date(j25.fetchedAt)}.` : "Membership data unavailable; reload to retry."} Membership matches names across all printings, including cards you own from other sets. It qualifies a card for the playset reserve, rather than protecting unlimited duplicates. The catalog is derived automatically from <a href="https://github.com/hugooliveirad/jumpstart-atlas" target="_blank" rel="noopener noreferrer">Jumpstart Atlas</a>.</p></div><div class="info-copy" style="margin-top:24px"><h3>Card details · Scryfall</h3><p>Names, images, rarity, legality, and USD / EUR prices come from <a href="https://scryfall.com/docs/api" target="_blank" rel="noopener noreferrer">Scryfall</a>. Refresh card data to update prices and legality. Data is cached for 24 hours; data older than 7 days requires review before bulk recommendations.</p><p>Prices describe the selected printing and finish. They are market references, not a quote for the condition or language of your copy. Missing prices are never treated as zero. Set + collector number or Scryfall ID identifies a printing; a name alone gives a reference printing.</p><p>Collection files, quantities, and preferences stay in this browser. Scryfall receives card identifiers during lookup and any online search query, and its image host receives image requests. Export a backup before clearing browser storage. Other tabs and devices do not automatically sync.</p><p>Magic: The Gathering and card imagery belong to Wizards of the Coast. Card Sift is an independent fan project, inspired by <a href="https://hugobessa.com.br/jumpstart-atlas/">Jumpstart Atlas</a>.</p></div>`,
  );
}
function showGuide() {
  modal(
    "A sorting plan you can explain",
    "Keep useful cards accessible, and know why the rest can go into bulk.",
    `<div class="guide-steps">${[
      [
        "Choose what you play",
        "Select your formats. Tournament mode requires actual mainboard or sideboard evidence. Legality mode also keeps cards with no recorded tournament use. Commander has legality support; no Commander play statistics are bundled.",
      ],
      [
        "Reserve copies by card or land printing",
        "Nonlands share one reserve per card name across sets. Lands reserve only copies of the same printing (Scryfall ID or set + collector number), including its finishes. Set separate limits for nonbasic lands and basics in the sidebar. Copies protected by rarity, value, or a manual keep already count toward their reserve. Enable J25 to qualify card names appearing in any Atlas Foundations Jumpstart deck, even when your copies come from other sets.",
      ],
      [
        "Protect the cards you care about",
        "Your rarity and price rules protect every matching copy. The rules combine with “or”: meeting any one is enough to keep a copy. Manual decisions take priority over all automatic rules.",
      ],
      [
        "Review before you box",
        "Unknown cards, missing prices, uncertain printings, and old data go to Needs review unless already protected by a keep rule. A printing can have copies in multiple piles. Open a card to see the explanation or override the decision.",
      ],
      [
        "Export your sorting plan",
        "Table and grid share type inclusion/exclusion, set search, and advanced queries. Most tournament play sorts by the highest deck share in your selected formats. Card dialogs follow the entire filtered, sorted list with Previous/Next and arrow keys. Back and Escape return from editing to the same card and scroll position. Export the full plan or current view as CSV; backups preserve rules and decisions.",
      ],
    ]
      .map(
        ([title, body], i) =>
          `<div class="guide-step"><span>${i + 1}</span><div><h3>${title}</h3><p>${body}</p></div></div>`,
      )
      .join("")}</div>`,
  );
}
function exportDialog() {
  if (!state.rows.length) {
    toast("Import a collection before exporting a sorting plan.");
    return;
  }
  modal(
    "Export your sorting plan",
    "Quantities stay separate, so you can physically sort each printing.",
    `<div class="info-copy"><p>The CSV includes card name, set, collector number, finish, owned / keep / bulk / review quantities, unit price, price precision, data dates, and reasons.</p><p>Current view: ${count(filteredRows().length)} printings. Full collection: ${count(results.length)} printings.</p></div>`,
    `<button class="button quiet" data-export="view">Export current view</button><button class="button primary" data-export="all">Export full collection</button>`,
  );
}
function exportPlan(scope) {
  const rows = scope === "all" ? results : filteredRows();
  const headers = [
    "Name",
    "Set code",
    "Collector number",
    "Finish",
    "Owned",
    "Keep",
    "Bulk",
    "Review",
    "Unit price",
    "Currency",
    "Price precision",
    "Card data date",
    "Evidence date",
    "Override",
    "Tournament share (%)",
    "J25 deck member",
    "Reasons",
    "Review notes",
  ];
  download(
    "card-sift-sorting-plan.csv",
    csvText(
      headers,
      rows.map((r) => [
        r.name,
        r.set,
        r.number,
        r.finish,
        r.quantity,
        r.keep,
        r.bulk,
        r.review,
        r.price,
        state.rules.currency.toUpperCase(),
        r.exact ? "printing" : "reference",
        r.fetchedAt ? new Date(r.fetchedAt).toISOString() : "",
        snapshot?.fetchedAt || "",
        r.override || "",
        r.tournamentShare,
        r.j25 === null ? "unknown" : r.j25 ? "yes" : "no",
        r.reasons.join("; "),
        r.uncertainties.join("; "),
      ]),
    ),
    "text/csv",
  );
  closeModal();
}
function resetFilters() {
  setQuery = "";
  typeInclude = [];
  typeExclude = [];
  $("#set-search").value = "";
  document.querySelectorAll("[data-type]").forEach((el) => (el.value = ""));
  $("#advanced-form").reset();
  query = "";
  color = "";
  rarity = "";
  filter = "all";
  page = 1;
  $("#search").value = "";
  $("#color-filter").value = "";
  $("#rarity-filter").value = "";
  updateSearch();
  render();
}
async function action(name) {
  if (!ready) {
    toast("Loading your saved collection…");
    return;
  }
  switch (name) {
    case "previous-card":
      stepCard(-1);
      break;
    case "next-card":
      stepCard(1);
      break;
    case "back-card":
      backToCard();
      break;
    case "close":
      closeModal();
      break;
    case "collection":
      $("#collection").scrollIntoView({ behavior: "smooth" });
      break;
    case "rules":
      $(".sidebar").scrollIntoView({ behavior: "smooth" });
      break;
    case "import":
      openImport();
      break;
    case "demo":
      await loadExample();
      break;
    case "exit-demo":
      exitDemo();
      break;
    case "backup":
      backup();
      break;
    case "search-help":
      showSearchHelp();
      break;
    case "sources":
      showSources();
      break;
    case "guide":
      showGuide();
      break;
    case "reset-rules":
      state.rules = structuredClone(DEFAULT_RULES);
      syncRules();
      render();
      persist();
      toast("Default keep rules restored.");
      break;
    case "clear-filters":
      resetFilters();
      break;
    case "sync":
      await sync(true);
      break;
    case "cancel-sync":
      syncController?.abort();
      break;
    case "preview-paste":
      try {
        importState.result = parseDecklist($("#decklist").value);
        importState.error = "";
      } catch (err) {
        importState.error = err.message;
      }
      renderImport();
      break;
    case "commit-import":
      await commitImport();
      break;
    case "template":
      download(
        "card-sift-template.csv",
        "Name,Quantity,Set Code,Collector Number,Finish\nLightning Bolt,8,m11,149,nonfoil\nCounterspell,4,mh2,267,nonfoil\n",
        "text/csv",
      );
      break;
    case "issues":
      download(
        "card-sift-import-issues.csv",
        csvText(
          ["Row", "Name", "Issue"],
          importState.result.issues.map((i) => [i.row, i.name, i.message]),
        ),
        "text/csv",
      );
      break;
    case "undo-import":
      if (undoState && !busy) {
        state = undoState;
        undoState = null;
        $("#sync-status").hidden = true;
        syncRules();
        render();
        await persist();
        toast("Previous collection restored.");
      }
      break;
    case "edit-card":
      editCard();
      break;
    case "save-card":
      await saveCard();
      break;
    case "copy-card": {
      const row = state.rows.find((r) => r.id === detailId);
      const text = `${row.quantity} ${row.name}${row.set && row.number ? " (" + row.set.toUpperCase() + ") " + row.number : ""}${row.finish === "foil" ? " *F*" : row.finish === "etched" ? " *E*" : ""}`;
      try {
        await navigator.clipboard.writeText(text);
        toast("Decklist line copied.");
      } catch {
        modal(
          "Copy this decklist line",
          "Select the text and copy it.",
          `<textarea readonly aria-label="Decklist line">${e(text)}</textarea>`,
        );
      }
      break;
    }
    case "export":
      exportDialog();
      break;
  }
}
document.addEventListener("click", async (event) => {
  const target = event.target.closest("button");
  if (!target || target.disabled) return;
  try {
    if (target.dataset.action) await action(target.dataset.action);
    else if (target.dataset.detail) showDetail(target.dataset.detail);
    else if (target.dataset.version)
      showDetail(target.dataset.version, { preserve: true });
    else if (target.dataset.query) {
      query = target.dataset.query;
      $("#search").value = query;
      closeModal();
      updateSearch();
      $("#search").focus();
    } else if (target.dataset.filter) {
      filter = target.dataset.filter;
      page = 1;
      render();
    } else if (target.dataset.view) {
      view = target.dataset.view;
      render();
    } else if (target.dataset.page) {
      page = Number(target.dataset.page);
      renderResults();
      $("#collection").scrollIntoView({ behavior: "instant" });
    } else if (target.dataset.export) exportPlan(target.dataset.export);
  } catch (err) {
    toast(err.message);
  }
});
document.addEventListener("change", async (event) => {
  const target = event.target;
  if (target.closest("#rules")) changeRules();
  else if (target.id === "collection-file") await readFile(target.files[0]);
  else if (target.dataset.mapping) {
    importState.parsed.mapping[target.dataset.mapping] = Number(target.value);
    importState.ack = false;
    recalcImport();
  } else if (target.name === "import-mode") {
    importState.mode = target.value;
    renderImport();
  } else if (target.id === "ack-issues") {
    importState.ack = target.checked;
    renderImport();
  } else if (target.id === "row-override") {
    const row = state.rows.find((r) => r.id === detailId);
    if (target.value) row.override = target.value;
    else delete row.override;
    render();
    persist();
    showDetail(detailId, { preserve: true });
  } else if (target.dataset.type) {
    typeInclude = [...document.querySelectorAll("[data-type]")]
      .filter((el) => el.value === "include")
      .map((el) => el.dataset.type);
    typeExclude = [...document.querySelectorAll("[data-type]")]
      .filter((el) => el.value === "exclude")
      .map((el) => el.dataset.type);
    page = 1;
    renderResults();
  } else if (target.id === "color-filter") {
    color = target.value;
    page = 1;
    renderResults();
  } else if (target.id === "rarity-filter") {
    rarity = target.value;
    page = 1;
    renderResults();
  } else if (target.id === "sort") {
    sort = target.value;
    page = 1;
    renderResults();
  }
});
$("#search").addEventListener("input", (event) => {
  query = event.target.value;
  updateSearch();
});
$("#set-search").addEventListener("input", (event) => {
  setQuery = event.target.value;
  page = 1;
  renderResults();
});
$("#advanced-form").addEventListener("submit", (event) => {
  event.preventDefault();
  applyAdvanced();
});
$("#rules").addEventListener("submit", (event) => {
  event.preventDefault();
  changeRules();
});
document.addEventListener("submit", (event) => {
  if (event.target.id === "edit-form") {
    event.preventDefault();
    saveCard();
  }
});
$("#dialog").addEventListener("close", restoreModalOrigin);
$("#dialog").addEventListener("cancel", (event) => {
  const openLinks = $("#dialog .links-menu[open]");
  if (openLinks) {
    event.preventDefault();
    openLinks.open = false;
    openLinks.querySelector("summary").focus({ preventScroll: true });
  } else if (dialogMode === "edit") {
    event.preventDefault();
    backToCard();
  }
});
document.addEventListener("keydown", (event) => {
  const editing =
    ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName) ||
    event.target.isContentEditable;
  if (
    $("#dialog").open &&
    dialogMode === "card" &&
    !editing &&
    ["ArrowLeft", "ArrowRight"].includes(event.key)
  ) {
    event.preventDefault();
    stepCard(event.key === "ArrowLeft" ? -1 : 1);
    return;
  }
  if (
    event.key === "/" &&
    !["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName) &&
    !$("#dialog").open
  ) {
    event.preventDefault();
    $("#search").focus();
  }
});
document.addEventListener("dragover", (event) => {
  if (event.target.closest("#drop-zone")) {
    event.preventDefault();
    $("#drop-zone").classList.add("drag-over");
  }
});
document.addEventListener("dragleave", (event) => {
  if (event.target.closest("#drop-zone"))
    $("#drop-zone").classList.remove("drag-over");
});
document.addEventListener("drop", (event) => {
  if (event.target.closest("#drop-zone")) {
    event.preventDefault();
    readFile(event.dataTransfer.files[0]);
  }
});
window.addEventListener("beforeunload", (event) => {
  if (persistentError || busy) {
    event.preventDefault();
    event.returnValue = "";
  }
});
async function init() {
  icons();
  $("#format-options").innerHTML = Object.entries(FORMATS)
    .map(
      ([key, label]) =>
        `<label class="format-chip"><input type="checkbox" name="formats" value="${key}"><span>${label}</span></label>`,
    )
    .join("");
  setupFilters();
  syncRules();
  render();
  const loaded = await Promise.allSettled([
    read("state", "collection"),
    fetch("./data/metagame.json").then((r) => {
      if (!r.ok) throw new Error();
      return r.json();
    }),
    fetch("./data/j25.json").then((r) => {
      if (!r.ok) throw new Error();
      return r.json();
    }),
    fetch("./data/example.json").then((r) => {
      if (!r.ok) throw new Error();
      return r.json();
    }),
    fetch("./data/archetypes.json").then((r) => {
      if (!r.ok) throw new Error();
      return r.json();
    }),
  ]);
  if (loaded[0].status === "fulfilled" && loaded[0].value) {
    try {
      const saved = loaded[0].value;
      validateBackup({ app: "card-sift", schema: 1, ...saved });
      state = { rows: saved.rows, rules: validateRules(saved.rules) };
    } catch {
      loadFailed = true;
      storageWarning(
        "The saved collection could not be read. It has not been overwritten. Download a recovery file, then reload.",
      );
      const raw = loaded[0].value;
      $("#storage-warning").appendChild(
        Object.assign(document.createElement("button"), {
          className: "text-button",
          textContent: "Download recovery file",
          onclick: () =>
            download(
              "card-sift-recovery.json",
              JSON.stringify(raw),
              "application/json",
            ),
        }),
      );
    }
  } else if (loaded[0].status === "rejected")
    storageWarning(loaded[0].reason.message);
  if (loaded[1].status === "fulfilled") snapshot = loaded[1].value;
  if (loaded[2].status === "fulfilled") j25 = loaded[2].value;
  if (loaded[4].status === "fulfilled") {
    try {
      archetypeIndex = buildArchetypeIndex(loaded[4].value);
      archetypes = loaded[4].value;
    } catch {
      archetypes = null;
    }
  }
  if (loaded[3].status === "fulfilled") {
    example = loaded[3].value;
    const arts = example.rows.filter((r) => r.card?.image);
    if (arts[0]) $("#hero-one").src = safeURL(arts[0].card.image, "image");
    if (arts[4]) $("#hero-two").src = safeURL(arts[4].card.image, "image");
  }
  ready = true;
  syncRules();
  render();
  if (!snapshot) {
    $("#sync-status").hidden = false;
    $("#sync-status").textContent =
      "Tournament evidence could not load. Reload the page to retry; uncertain cards stay in Needs review.";
  }
}
init().catch((err) =>
  storageWarning("Startup failed: " + err.message + " Reload to try again."),
);
