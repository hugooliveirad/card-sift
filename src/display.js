import { isExact, norm, groupKey } from "./core.js";

export const finishName = (finish) =>
  ({ nonfoil: "Nonfoil", foil: "Foil", etched: "Etched foil" })[finish] ||
  finish;
export const isFoil = (row) => ["foil", "etched"].includes(row.finish);

export function printingKey(row) {
  if (isExact(row)) return "id:" + row.card.id;
  if (row.scryfallId)
    return JSON.stringify([norm(row.name), row.scryfallId.toLowerCase()]);
  if (row.set && row.number)
    return JSON.stringify([norm(row.name), row.set.toLowerCase(), row.number]);
  // A reference image does not identify the printing the user owns.
  return "unresolved:" + row.id;
}

export function groupPrintings(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = printingKey(row);
    if (!groups.has(key))
      groups.set(key, {
        ...row,
        versions: [],
        quantity: 0,
        keep: 0,
        bulk: 0,
        review: 0,
      });
    const group = groups.get(key);
    group.versions.push(row);
    for (const field of ["quantity", "keep", "bulk", "review"])
      group[field] += row[field] || 0;
  }
  return [...groups.values()];
}

export function ownedVersions(row, rows) {
  return rows.filter(
    (other) =>
      groupKey(other) === groupKey(row) ||
      norm(other.card?.name || other.name) === norm(row.card?.name || row.name),
  );
}

const FORMAT_CODES = {
  pauper: "PAU",
  standard: "ST",
  modern: "MO",
  premodern: "PREM",
  pioneer: "PI",
  legacy: "LE",
  vintage: "VI",
  duel: "EDH",
};
export function tournamentURL(name, format) {
  const query = new URLSearchParams({
    cards: name.split(" // ")[0],
    MD_check: "1",
    SB_check: "1",
  });
  if (FORMAT_CODES[format]) query.set("format", FORMAT_CODES[format]);
  return "https://www.mtgtop8.com/search?" + query;
}
export const ligaURL = (name) =>
  "https://www.ligamagic.com.br/?" +
  new URLSearchParams({ view: "cards/card", card: name });
