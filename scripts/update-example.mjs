import { writeFile } from "node:fs/promises";
import { compactCard } from "../src/data.js";
const cards = [
  ["Lightning Bolt", 12],
  ["Counterspell", 7],
  ["Llanowar Elves", 9],
  ["Duress", 6],
  ["Sol Ring", 3],
  ["Dark Ritual", 8],
  ["Swords to Plowshares", 6],
  ["Shivan Dragon", 2],
  ["Opt", 10],
  ["Grizzly Bears", 16],
  ["Divination", 9],
  ["Forest", 35],
  ["Wrath of God", 2],
  ["Brainstorm", 8],
  ["Naturalize", 12],
  ["Doom Blade", 7],
  ["Ornithopter", 8],
  ["Evolving Wilds", 15],
];
const response = await fetch("https://api.scryfall.com/cards/collection", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "CardSift/1.0 (github.com/hugooliveirad/card-sift)",
  },
  body: JSON.stringify({ identifiers: cards.map(([name]) => ({ name })) }),
  signal: AbortSignal.timeout(30000),
});
if (!response.ok) throw new Error("Example lookup failed: " + response.status);
const data = await response.json();
if (data.not_found?.length || data.data.length !== cards.length)
  throw new Error("Incomplete example card data");
const rows = cards.map(([name, quantity], i) => {
  const c = data.data.find((c) => c.name === name);
  if (!c) throw new Error("No exact example match: " + name);
  return {
    id: "example-" + i,
    name: c.name,
    quantity,
    set: c.set,
    number: c.collector_number,
    scryfallId: c.id,
    finish: c.finishes.includes("nonfoil") ? "nonfoil" : c.finishes[0],
    card: compactCard(c),
    fetchedAt: Date.now(),
  };
});
const foilExample = rows.find(
  (row) => row.card.finishes.includes("foil") && row.quantity >= 6,
);
if (foilExample) {
  foilExample.quantity -= 2;
  rows.push({
    ...foilExample,
    id: foilExample.id + "-foil",
    quantity: 2,
    finish: "foil",
  });
}
await writeFile(
  "data/example.json",
  JSON.stringify(
    { example: true, fetchedAt: new Date().toISOString(), rows },
    null,
    2,
  ) + "\n",
);
console.log("Refreshed " + rows.length + " example printings.");
