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
} from "./core.js";
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
  toastTimer,
  saveChain = Promise.resolve();
let persistentError = "",
  loadFailed = false,
  ready = false;
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
  for (const key of ["copies", "basics", "minShare", "threshold"])
    next[key] = Number(input.get(key));
  for (const key of [
    "formatMode",
    "playsets",
    "rarity",
    "currency",
    "preference",
  ])
    next[key] = input.get(key);
  for (const key of ["priceEnabled", "trustReference"])
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
  return `${row.set ? row.set.toUpperCase() : "Unspecified set"}${row.number ? " #" + row.number : ""} · ${row.finish === "nonfoil" ? "Nonfoil" : row.finish === "etched" ? "Etched" : "Foil"}`;
}
function filteredRows() {
  return results
    .filter(
      (row) =>
        (filter === "all" || row[filter] > 0) &&
        (!query ||
          norm(
            `${row.name} ${row.card?.type_line || ""} ${row.card?.oracle_text || ""}`,
          ).includes(norm(query))) &&
        (!rarity || row.card?.rarity === rarity) &&
        (!color ||
          (row.card &&
            (color === "C"
              ? !row.card.colors?.length
              : color === "M"
                ? row.card.colors?.length > 1
                : row.card.colors?.includes(color)))),
    )
    .sort((a, b) => {
      const diff =
        sort === "price"
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
    });
}
function render() {
  results = analyze(state.rows, state.rules, snapshot);
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
    ? `${count(new Set(state.rows.map(groupKey)).size)} card names · ${count(state.rows.length)} printings`
    : "Your cards, all in one place";
  $("#row-count").textContent = count(state.rows.length) + " printings";
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
  const rows = filteredRows();
  const pages = Math.max(1, Math.ceil(rows.length / 48));
  page = Math.min(page, pages);
  const visible = rows.slice((page - 1) * 48, page * 48);
  if (!state.rows.length) {
    $("#results").innerHTML =
      `<div class="empty"><div class="empty-icon">${icon("layers")}</div><h3>Good cards deserve to be found.</h3><p>Import your collection to see what to keep, what to box up, and what needs a closer look.</p><div class="row wrap"><button class="button primary small" data-action="import">${icon("upload")} Import cards</button><button class="text-button" data-action="demo">Try an example ${icon("arrow")}</button></div></div>`;
  } else if (!rows.length) {
    $("#results").innerHTML =
      `<div class="empty"><div class="empty-icon">${icon("search")}</div><h3>No cards match this view.</h3><p>Try another search or clear the filters to see your collection.</p><button class="button quiet small" data-action="clear-filters">Clear filters</button></div>`;
  } else if (view === "table") {
    $("#results").innerHTML =
      `<div class="table-wrap" tabindex="0" role="region" aria-label="Collection table, scroll horizontally for all columns"><table><thead><tr><th scope="col">Card / printing</th><th scope="col">Rarity</th><th scope="col">Owned</th><th scope="col">Unit price</th><th scope="col">Sorting plan</th><th scope="col">Why</th><th scope="col"><span class="sr-only">Details</span></th></tr></thead><tbody>${visible.map((row) => `<tr><td><button class="card-cell" data-detail="${e(row.id)}"><span class="thumb">${safeURL(row.card?.art, "image") ? `<img src="${e(safeURL(row.card.art, "image"))}" alt="" loading="lazy">` : icon("layers")}</span><span><strong>${e(row.name)}</strong><small>${e(printing(row))}</small></span></button></td><td><span class="rarity ${e(row.card?.rarity || "")}">${e(row.card?.rarity || "Unknown")}</span></td><td class="number">${count(row.quantity)}</td><td class="number">${money(row.price)}<span class="price-note">${row.price === null ? "Unavailable" : row.exact ? "Printing price" : "Reference price"}</span></td><td>${pills(row)}</td><td class="reason-cell">${e(reason(row))}</td><td><button class="more-button" data-detail="${e(row.id)}" aria-label="Details for ${e(row.name)}">${icon("chevron")}</button></td></tr>`).join("")}</tbody></table></div>`;
  } else {
    $("#results").innerHTML =
      `<div class="card-grid">${visible.map((row) => `<article class="grid-card"><button class="grid-image" data-detail="${e(row.id)}" aria-label="Details for ${e(row.name)}">${safeURL(row.card?.image, "image") ? `<img src="${e(safeURL(row.card.image, "image"))}" alt="${e(row.name)}" loading="lazy" width="488" height="680">` : '<span class="image-placeholder">◈</span>'}<span class="grid-qty">${count(row.quantity)} owned</span></button><div class="grid-body"><button class="grid-name" data-detail="${e(row.id)}">${e(row.name)}</button><div class="grid-meta"><span>${e(printing(row))}</span><span class="number">${money(row.price)}${row.price !== null && !row.exact ? " ref." : ""}</span></div>${pills(row)}<p class="grid-reason">${e(reason(row))}</p></div></article>`).join("")}</div>`;
  }
  $("#pagination").innerHTML = rows.length
    ? `<span>${count((page - 1) * 48 + 1)}–${count(Math.min(page * 48, rows.length))} of ${count(rows.length)} printings</span><div class="row"><button class="button quiet small" data-page="${page - 1}" ${page === 1 ? "disabled" : ""}>Previous</button><span>${page} / ${pages}</span><button class="button quiet small" data-page="${page + 1}" ${page === pages ? "disabled" : ""}>Next</button></div>`
    : "";
}
function modal(title, subtitle, body, footer = "") {
  $("#dialog-content").innerHTML =
    `<div class="dialog-header"><div><h2 id="dialog-title">${e(title)}</h2>${subtitle ? `<p>${e(subtitle)}</p>` : ""}</div><button class="close-button" data-action="close" aria-label="Close dialog">${icon("close")}</button></div><div class="dialog-body">${body}</div>${footer ? `<div class="dialog-footer">${footer}</div>` : ""}`;
  const dialog = $("#dialog");
  dialog.setAttribute("aria-labelledby", "dialog-title");
  if (!dialog.open) dialog.showModal();
}
function closeModal() {
  $("#dialog").close();
  detailId = null;
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
function showDetail(id) {
  detailId = id;
  const row = results.find((r) => r.id === id);
  if (!row) return;
  const c = row.card,
    link = safeURL(c?.scryfall_uri),
    img = safeURL(c?.image, "image");
  modal(
    row.name,
    printing(row),
    `<div class="detail-layout"><div>${img ? `<img class="detail-image" src="${e(img)}" alt="${e(row.name)}">` : '<div class="no-image">Card image unavailable</div>'}<div class="detail-price">${money(row.price)}</div><p class="hint">${row.exact ? "Exact printing" : "Reference printing"} · ${e(row.finish)}<br>${c ? `Scryfall price · ${date(row.fetchedAt)}` : "Refresh card data to look up this card."}</p>${link ? `<a class="text-button" href="${e(link)}" target="_blank" rel="noopener noreferrer">Open in Scryfall ${icon("external")}</a>` : ""}</div><div><div class="detail-meta">${e(c?.type_line || "Card details unavailable")}<br>${e(c?.mana_cost || "")} ${c ? " · " + e(c.rarity) : ""} · ${count(row.quantity)} owned</div>${pills(row)}<h3>Why these copies go here</h3><ul class="detail-reasons">${[...new Set(row.reasons)].map((reason) => `<li>${e(reason)}</li>`).join("")}${row.review ? row.uncertainties.map((reason) => `<li>${e(reason)}</li>`).join("") : ""}</ul>
    ${row.played.length ? `<h3>Play evidence</h3>${row.played.map((hit) => `<div class="source-row"><div>${e(FORMATS[hit.format])}<small>Mainboard ${hit.mainboard}% · Sideboard ${hit.sideboard}%</small></div><a href="${e(safeURL(hit.url))}" target="_blank" rel="noopener noreferrer">Source</a></div>`).join("")}<p class="hint">MTGTop8 · ${e(snapshot.window)} · fetched ${date(snapshot.fetchedAt)}. Mainboard and sideboard percentages are not added together.</p>` : ""}
    <h3>Your decision</h3><label class="field">Override for this printing<select id="row-override"><option value="" ${!row.override ? "selected" : ""}>Follow my keep rules</option><option value="keep" ${row.override === "keep" ? "selected" : ""}>Keep every copy</option><option value="bulk" ${row.override === "bulk" ? "selected" : ""}>Put every copy in bulk</option></select></label><div class="detail-actions"><button class="button quiet small" data-action="edit-card">Edit card / quantity</button><button class="button quiet small" data-action="copy-card">Copy decklist line</button></div></div></div>
    ${
      c
        ? `<details class="native-details"><summary>Card text and format legalities</summary><p class="oracle-text" style="margin:15px 0">${e(c.oracle_text)}</p><div class="legalities">${Object.entries(
            FORMATS,
          )
            .map(
              ([key, label]) =>
                `<span class="${["legal", "restricted"].includes(c.legalities?.[key]) ? "" : "illegal"}">${label}: ${e(c.legalities?.[key] || "unknown")}</span>`,
            )
            .join("")}</div></details>`
        : ""
    }`,
  );
}
function editCard() {
  const row = state.rows.find((r) => r.id === detailId);
  if (!row) return;
  modal(
    "Edit card",
    "Correct an identifier or update how many copies you own.",
    `<form id="edit-form"><div class="edit-fields"><label class="field wide">English card name<input name="name" required maxlength="300" value="${e(row.name)}"></label><label class="field">Quantity<input name="quantity" type="number" min="1" max="100000" step="1" required value="${row.quantity}"></label><label class="field">Finish<select name="finish">${["nonfoil", "foil", "etched"].map((f) => `<option ${f === row.finish ? "selected" : ""}>${f}</option>`).join("")}</select></label><label class="field">Set code<input name="set" value="${e(row.set)}"></label><label class="field">Collector number<input name="number" value="${e(row.number)}"></label><label class="field wide">Scryfall ID (optional, overrides name and set)<input name="scryfallId" value="${e(row.scryfallId)}" pattern="[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}"></label></div><p class="hint">To switch cards or printings, clear the old Scryfall ID first. Card details will be fetched again after saving.</p></form>`,
    `<button class="button quiet" data-detail="${e(row.id)}">Cancel</button><button class="button primary" data-action="save-card">Save changes</button>`,
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
  closeModal();
  render();
  await persist();
  if (!previousState) sync();
}
function showSources() {
  const old =
    !snapshot || Date.now() - Date.parse(snapshot.fetchedAt) > 35 * 86400000;
  modal(
    "Where the recommendations come from",
    "Facts, dates, and the limits of each source.",
    `<div class="info-copy"><h3>Tournament play · MTGTop8</h3><p>A dated snapshot of the ${snapshot?.window?.toLowerCase() || "last two months"} of tournament deck statistics. We include up to 100 mainboard and 100 sideboard cards per format, each appearing in at least 1% of decks in that section. Basic lands are excluded from this sample and use your separate reserve.</p><p><strong>Absence from this sample does not mean a card never sees play.</strong> Your selected minimum share is checked against either section. A card must also be currently legal or restricted according to Scryfall to qualify.</p><p>Snapshot fetched: <strong>${date(snapshot?.fetchedAt)}</strong>. The hosted site refreshes weekly. ${old ? "Missing or old evidence sends uncertain copies to Needs review." : "The snapshot is current."}</p></div>
    ${Object.entries(FORMATS)
      .map(
        ([format, label]) =>
          `<div class="source-row"><div>${label}<small>${snapshot?.formats?.[format] ? count(snapshot.formats[format].cards.length) + " sampled card names" : "No tournament source bundled · legality mode available"}</small></div>${snapshot?.formats?.[format] ? `<a href="${e(safeURL(snapshot.formats[format].url))}" target="_blank" rel="noopener noreferrer">View MTGTop8 ${icon("external")}</a>` : ""}</div>`,
      )
      .join("")}
    <div class="info-copy" style="margin-top:24px"><h3>Card details · Scryfall</h3><p>Names, images, rarity, legality, and USD / EUR prices come from <a href="https://scryfall.com/docs/api" target="_blank" rel="noopener noreferrer">Scryfall</a>. Refresh card data to update prices and legality. Data is cached for 24 hours; data older than 7 days requires review before bulk recommendations.</p><p>Prices describe the selected printing and finish. They are market references, not a quote for the condition or language of your copy. Missing prices are never treated as zero. Set + collector number or Scryfall ID identifies a printing; a name alone gives a reference printing.</p><p>Collection files, quantities, and preferences stay in this browser. Scryfall receives card identifiers during lookup, and its image host receives image requests. Export a backup before clearing browser storage. Other tabs and devices do not automatically sync.</p><p>Magic: The Gathering and card imagery belong to Wizards of the Coast. Card Sift is an independent fan project, inspired by <a href="https://hugobessa.com.br/jumpstart-atlas/">Jumpstart Atlas</a>.</p></div>`,
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
        "Reserve a playset, across printings",
        "Keep four, one, or another number per card name. Copies already protected by rarity, value, or a manual keep count toward that reserve. You can also reserve a playset of every card, or turn playset reserves off. Basic lands use their own number.",
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
        "Table and grid show the same recommendations. Search, filter, and sort to work through your collection; export the full plan or the current view as CSV. Backups preserve your inventory, rules, and overrides.",
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
        r.reasons.join("; "),
        r.uncertainties.join("; "),
      ]),
    ),
    "text/csv",
  );
  closeModal();
}
function resetFilters() {
  query = "";
  color = "";
  rarity = "";
  filter = "all";
  page = 1;
  $("#search").value = "";
  $("#color-filter").value = "";
  $("#rarity-filter").value = "";
  render();
}
async function action(name) {
  if (!ready) {
    toast("Loading your saved collection…");
    return;
  }
  switch (name) {
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
    else if (target.dataset.filter) {
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
    showDetail(detailId);
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
  page = 1;
  renderResults();
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
document.addEventListener("keydown", (event) => {
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
  syncRules();
  render();
  const loaded = await Promise.allSettled([
    read("state", "collection"),
    fetch("./data/metagame.json").then((r) => {
      if (!r.ok) throw new Error();
      return r.json();
    }),
    fetch("./data/example.json").then((r) => {
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
  if (loaded[2].status === "fulfilled") {
    example = loaded[2].value;
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
