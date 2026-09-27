import { norm } from "./core.js";
import { applyCard } from "./data.js";

export function indexSetCache(snapshot) {
  const index = {
    byId: new Map(),
    byPrinting: new Map(),
    byName: new Map(),
    fetchedAt: Date.parse(snapshot?.fetchedAt),
  };
  for (const card of snapshot?.cards || []) {
    index.byId.set(card.id, card);
    index.byPrinting.set(`${card.set}:${card.collector_number}`, card);
    for (const name of card.names || [card.name]) {
      for (const key of [norm(name), `${card.set}:${norm(name)}`]) {
        if (!index.byName.has(key)) index.byName.set(key, card);
      }
    }
  }
  return index;
}
export function cachedPrinting(row, index) {
  return row.scryfallId
    ? index?.byId.get(row.scryfallId.toLowerCase())
    : row.set && row.number
      ? index?.byPrinting.get(`${row.set.toLowerCase()}:${row.number}`)
      : index?.byName.get(
          `${row.set ? row.set.toLowerCase() + ":" : ""}${norm(row.name)}`,
        );
}
export function hydrateSetCache(rows, index) {
  if (!Number.isFinite(index?.fetchedAt)) return 0;
  let applied = 0;
  for (const row of rows) {
    if (row.card?.dataVersion === 2 && row.fetchedAt >= index.fetchedAt)
      continue;
    const card = cachedPrinting(row, index);
    if (card && applyCard(row, { card, fetchedAt: index.fetchedAt })) applied++;
  }
  return applied;
}
