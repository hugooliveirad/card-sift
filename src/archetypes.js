import { norm } from "./core.js";

const cardName = (name) => norm(name).replace(/\s*\/+\s*/g, " // ");

export function buildArchetypeIndex(snapshot) {
  const index = new Map();
  for (const [format, data] of Object.entries(snapshot?.formats || {})) {
    for (const deck of data.decks) {
      const cards = new Map();
      for (const section of ["mainboard", "sideboard", "commander"]) {
        for (const [name, quantity] of Object.entries(deck[section])) {
          const key = cardName(name);
          if (!cards.has(key))
            cards.set(key, { mainboard: 0, sideboard: 0, commander: 0 });
          cards.get(key)[section] += quantity;
        }
      }
      for (const [name, quantities] of cards) {
        if (!index.has(name)) index.set(name, []);
        index.get(name).push({ format, deck, ...quantities });
      }
    }
  }
  return index;
}

export function archetypesFor(row, index) {
  const name = cardName(row.card?.name || row.name);
  const hits = [
    ...(index.get(name) || []),
    ...(name.includes(" // ") ? index.get(name.split(" // ")[0]) || [] : []),
  ];
  const groups = new Map();
  const seen = new Set();
  for (const hit of hits) {
    const deckKey = hit.format + ":" + hit.deck.id;
    if (seen.has(deckKey)) continue;
    seen.add(deckKey);
    const key = hit.format + ":" + hit.deck.archetype.id;
    if (!groups.has(key))
      groups.set(key, {
        format: hit.format,
        ...hit.deck.archetype,
        matches: [],
      });
    groups.get(key).matches.push(hit);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      matches: group.matches.sort((a, b) =>
        b.deck.playedAt.localeCompare(a.deck.playedAt),
      ),
    }))
    .sort(
      (a, b) =>
        b.matches.length - a.matches.length || a.name.localeCompare(b.name),
    );
}
