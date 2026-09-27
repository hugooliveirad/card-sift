import { writeFile, rename, mkdir } from "node:fs/promises";
import { compactCard } from "../src/data.js";

const roots = ["fdn", "j25", "hob", "sos"];
const excludedTypes = new Set(["alchemy"]);
const headers = {
  Accept: "application/json",
  "User-Agent": "CardSift/1.0 (github.com/hugooliveirad/card-sift)",
};
async function get(url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((resolve) =>
      setTimeout(resolve, 500 + 1000 * (2 ** attempt - 1)),
    );
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(30000),
    });
    if (response.status === 429 || response.status >= 500) continue;
    if (!response.ok) throw new Error(`Scryfall ${response.status}: ${url}`);
    return response.json();
  }
  throw new Error(`Scryfall unavailable: ${url}`);
}
const allSets = (await get("https://api.scryfall.com/sets")).data;
const included = new Set(roots);
for (let previous = -1; previous !== included.size; ) {
  previous = included.size;
  for (const set of allSets) {
    if (
      included.has(set.parent_set_code) &&
      !excludedTypes.has(set.set_type) &&
      !set.digital
    )
      included.add(set.code);
  }
}
const dates = new Set(
  allSets
    .filter((set) => roots.includes(set.code))
    .map((set) => set.released_at),
);
const cards = new Map();
const sets = [];
for (const code of [...included, "spg"]) {
  const set = allSets.find((set) => set.code === code);
  if (!set) throw new Error(`Missing requested set: ${code}`);
  let url = `https://api.scryfall.com/cards/search?${new URLSearchParams({ q: `set:${code} game:paper`, unique: "prints", include_variations: "true", include_extras: "true" })}`;
  let total = 0;
  while (url) {
    const page = await get(url);
    for (const card of page.data) {
      if (code === "spg" && !dates.has(card.released_at)) continue;
      cards.set(card.id, compactCard(card));
      total++;
    }
    url = page.has_more ? page.next_page : null;
    if (url && new URL(url).hostname !== "api.scryfall.com")
      throw new Error("Unexpected pagination URL");
  }
  if (code !== "spg" && !total) throw new Error(`Empty requested set: ${code}`);
  if (total)
    sets.push({
      code,
      name: set.name,
      parent: set.parent_set_code || null,
      releasedAt: set.released_at,
      printings: total,
    });
  console.log(`${code}: ${total} printings`);
}
const snapshot = {
  schema: 1,
  fetchedAt: new Date().toISOString(),
  source: "Scryfall",
  roots,
  priorityFormats: ["pauper", "duel"],
  sets,
  selection:
    "Paper cards in requested set families, plus Special Guests matching their release dates; tokens and front/art cards included as metadata only; Alchemy excluded",
  cards: [...cards.values()],
};
await mkdir("data", { recursive: true });
await writeFile("data/set-cache.tmp", JSON.stringify(snapshot) + "\n");
await rename("data/set-cache.tmp", "data/set-cache.json");
console.log(`Cached ${cards.size} printings across ${sets.length} sets.`);
