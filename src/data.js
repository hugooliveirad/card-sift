import { norm } from "./core.js";
let database;
export function db() {
  if (!database)
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open("card-sift-v1", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("state");
        request.result.createObjectStore("cards");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          new Error(
            "Browser storage is unavailable. Export a backup before leaving.",
          ),
        );
      request.onblocked = () =>
        reject(
          new Error(
            "Close other Card Sift tabs, then reload to enable storage.",
          ),
        );
    });
  return database;
}
export async function read(store, key) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction(store).objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function write(store, key, value) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(
        new Error(
          "Changes could not be saved. Export a backup before leaving.",
        ),
      );
    tx.onabort = tx.onerror;
  });
}
export const identifier = (row) =>
  row.scryfallId
    ? { id: row.scryfallId.toLowerCase() }
    : row.set && row.number
      ? { set: row.set, collector_number: row.number }
      : row.set
        ? { name: row.name, set: row.set }
        : { name: row.name };
function matches(card, id) {
  if (id.id) return card.id === id.id;
  if (id.collector_number)
    return card.set === id.set && card.collector_number === id.collector_number;
  const names = [
    card.name,
    card.printed_name,
    ...(card.card_faces || []).map((f) => f.name),
  ].filter(Boolean);
  return (
    (!id.set || card.set === id.set) &&
    names.some((n) => norm(n) === norm(id.name))
  );
}
export function compactCard(card) {
  const faces = card.card_faces || [];
  const images = card.image_uris || faces[0]?.image_uris || {};
  return {
    id: card.id,
    oracle_id: card.oracle_id,
    name: card.name,
    names: [
      card.name,
      card.printed_name,
      ...faces.flatMap((f) => [f.name, f.printed_name]),
    ].filter(Boolean),
    set: card.set,
    set_name: card.set_name,
    collector_number: card.collector_number,
    rarity: card.rarity,
    legalities: card.legalities,
    prices: card.prices,
    type_line: card.type_line,
    mana_cost: card.mana_cost || faces[0]?.mana_cost || "",
    colors: card.colors || faces[0]?.colors || [],
    oracle_text:
      card.oracle_text ||
      faces.map((f) => f.name + "\n" + f.oracle_text).join("\n\n"),
    image: images.normal,
    art: images.art_crop,
    scryfall_uri: card.scryfall_uri,
    finishes: card.finishes,
  };
}
export function applyCard(row, cached) {
  const placeholder = `${(row.set || "").toUpperCase()} #${row.number || row.scryfallId}`;
  const names = cached.card.names || [cached.card.name];
  if (
    norm(row.name) !== norm(placeholder) &&
    !names.some((name) => norm(name) === norm(row.name))
  ) {
    delete row.card;
    delete row.fetchedAt;
    row.lookupError = `Name and printing disagree: this identifier resolves to ${cached.card.name}. Edit the name or printing.`;
    return false;
  }
  Object.assign(row, cached, { name: cached.card.name, lookupError: "" });
  return true;
}
let lastRequest = 0;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function requestCards(identifiers, signal) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await delay(Math.max(0, 600 - (Date.now() - lastRequest)));
    signal?.throwIfAborted();
    lastRequest = Date.now();
    const response = await fetch("https://api.scryfall.com/cards/collection", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ identifiers }),
      signal: AbortSignal.any(
        [signal, AbortSignal.timeout(25000)].filter(Boolean),
      ),
    });
    if (response.status === 429 || response.status >= 500) {
      if (attempt === 2)
        throw new Error(
          `Scryfall is temporarily unavailable (${response.status}). Use Refresh card data to try again.`,
        );
      await delay(
        Math.min(
          15000,
          (Number(response.headers.get("Retry-After")) || 2 ** attempt) * 1000,
        ),
      );
      continue;
    }
    if (!response.ok)
      throw new Error(
        `Card lookup failed (${response.status}). Your imported copies are preserved; try Refresh card data.`,
      );
    return response.json();
  }
}
export async function enrich(
  rows,
  { force = false, signal, onProgress = () => {} } = {},
) {
  const pending = new Map();
  let completed = 0,
    unmatched = 0;
  for (const row of rows) {
    const id = identifier(row),
      key = JSON.stringify(id);
    if (!force && row.card && Date.now() - row.fetchedAt < 86400000) {
      completed++;
      continue;
    }
    if (!pending.has(key)) pending.set(key, { id, rows: [] });
    pending.get(key).rows.push(row);
  }
  const todo = [];
  for (const [key, entry] of pending) {
    signal?.throwIfAborted();
    const cached = force ? null : await read("cards", key).catch(() => null);
    if (cached && Date.now() - cached.fetchedAt < 86400000) {
      for (const row of entry.rows) if (!applyCard(row, cached)) unmatched++;
      completed += entry.rows.length;
    } else todo.push({ ...entry, key });
  }
  onProgress({ completed, total: rows.length, unmatched });
  for (let start = 0; start < todo.length; start += 75) {
    signal?.throwIfAborted();
    const batch = todo.slice(start, start + 75);
    const response = await requestCards(
      batch.map((e) => e.id),
      signal,
    );
    for (const entry of batch) {
      const match = response.data.find((card) => matches(card, entry.id));
      if (match) {
        const cached = { card: compactCard(match), fetchedAt: Date.now() };
        for (const row of entry.rows) if (!applyCard(row, cached)) unmatched++;
        await write("cards", entry.key, cached).catch(() => {});
      } else {
        for (const row of entry.rows) {
          delete row.card;
          delete row.fetchedAt;
          row.lookupError =
            "No Scryfall match. Edit this row’s name or printing, then refresh.";
        }
        unmatched += entry.rows.length;
      }
      completed += entry.rows.length;
    }
    onProgress({ completed, total: rows.length, unmatched });
  }
  return { completed, unmatched };
}
