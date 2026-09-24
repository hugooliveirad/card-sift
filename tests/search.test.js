import test from "node:test";
import assert from "node:assert/strict";
import {
  compileQuery,
  matchesQuery,
  typeMatches,
  setMatches,
  advancedQuery,
} from "../src/search.js";
const card = {
  id: "row",
  name: "Wood Elf",
  quantity: 6,
  keep: 4,
  bulk: 2,
  review: 0,
  j25: true,
  set: "j25",
  number: "1",
  finish: "nonfoil",
  card: {
    id: "print",
    set: "j25",
    collector_number: "1",
    set_name: "Foundations Jumpstart",
    type_line: "Artifact Creature — Elf",
    oracle_text: "When Wood Elf enters, draw a card.",
    colors: ["G"],
    color_identity: ["G"],
    mana_cost: "{2}{G}",
    cmc: 3,
    power: "2",
    toughness: "3",
    rarity: "uncommon",
    prices: { usd: "1.25" },
    legalities: { duel: "legal", modern: "banned" },
    artist: "Some Artist",
    flavor_text: "In the forest.",
    keywords: [],
    games: ["paper"],
    reprint: true,
  },
};
const matches = (q) => matchesQuery(card, compileQuery(q));
test("advanced terms combine with AND, OR, parentheses, and negation", () => {
  assert(matches("(t:creature OR t:instant) c:g mv<=3"));
  assert(!matches("t:creature -t:artifact"));
  assert(matches("-(t:land OR t:sorcery)"));
  assert(matches("t:land OR t:creature AND c:g"));
  assert(!matches("t:land OR t:creature AND c:r"));
});
test("type filters include any selected type and exclusions win", () => {
  assert(typeMatches(card, ["Creature", "Instant"], []));
  assert(!typeMatches(card, ["Creature"], ["Artifact"]));
  assert(!typeMatches({ ...card, card: null }, [], ["Land"]));
  assert(
    typeMatches(
      { ...card, card: { type_line: "Kindred Instant — Elf" } },
      ["Tribal"],
      [],
    ),
  );
});
test("set search uses owned printing data and supports full set names", () => {
  assert(setMatches(card, "J25"));
  assert(setMatches(card, "Foundations"));
  const unknown = { ...card, set: "", number: "" };
  assert(!setMatches(unknown, "J25"));
  assert(!matchesQuery(unknown, compileQuery("set:j25")));
  assert(!matchesQuery(unknown, compileQuery("-set:j25")));
});
test("quoted text, aliases, mana value, stats and price comparisons", () => {
  assert(matches('o:"draw a card" pow>=2 tou=3 usd<2'));
  assert(matches('o:"when ~ enters" a:"some artist" ft:forest m:2g'));
  assert(matches("s:j25 r>=uncommon -r:rare"));
  assert(matches('name:"Wood Elf"'));
  assert(matches("Wood Elf"));
});
test("color and commander identity support exact and subset comparisons", () => {
  assert(matches("c=g id<=ug"));
  assert(!matches("c=ug"));
  assert(!matches("id<=wu"));
  assert(matches("c>=1"));
  assert(!matches("c:c"));
  assert(
    matchesQuery(
      { ...card, card: { ...card.card, colors: [] } },
      compileQuery("c:c"),
    ),
  );
});
test("format status and local sorting predicates are independent", () => {
  assert(matches("f:duel banned:modern is:bulk is:keep is:j25 is:nonfoil"));
  assert(!matches("f:modern"));
  assert(!matches("is:review"));
  assert(!matches("is:foil"));
});
test("missing data never becomes a negative metadata match", () => {
  const unknown = { ...card, card: null };
  assert(!matchesQuery(unknown, compileQuery("-t:land")));
  assert(!matchesQuery(unknown, compileQuery("-(c:r OR mv>3)")));
  assert(matchesQuery(unknown, compileQuery("name:wood OR t:land")));
});
test("query parser reports malformed input instead of pretending no cards exist", () => {
  for (const q of [
    'o:"draw',
    "(t:land",
    "t:land)",
    "t:land OR",
    "AND t:land",
    "mv:",
  ])
    assert.throws(() => compileQuery(q));
});
test("online-only fields are identified without weakening boolean semantics", () => {
  assert(compileQuery("lore:urza OR is:funny").requiresRemote);
  assert(compileQuery("lore:urza is:bulk").hasCollectionTerms);
  assert(!compileQuery("t:creature mv<=3").requiresRemote);
});
test("advanced controls compose escaped queries, type exclusions and OR groups", () => {
  const q = advancedQuery({
    name: "Wood",
    type: "creature -land",
    oracle: "draw a card",
    colors: ["G"],
    colorOp: "=",
    identity: ["G", "U"],
    stat: "mv",
    statOp: "<=",
    statValue: "3",
    format: "duel",
    formatStatus: "legal",
    price: "usd",
    priceOp: "<",
    priceValue: "2",
    rarities: ["common", "uncommon"],
    games: ["paper", "mtgo"],
  });
  assert(matches(q));
  assert(q.includes('-t:"land"'));
  assert(q.includes("OR"));
});

test("empty advanced controls produce an empty query", () =>
  assert.equal(advancedQuery({}), ""));
test("mana-cost and regex expressions use Scryfall rather than approximate local matching", () => {
  assert(compileQuery("m:WW").requiresRemote);
  assert(compileQuery("o:/draw/").requiresRemote);
});
test("remote search only completes when every pagination page succeeds", async (t) => {
  const { searchRemote } = await import("../src/search.js");
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () =>
    ++calls === 1
      ? new Response(
          JSON.stringify({
            total_cards: 2,
            data: [{ id: "first" }],
            has_more: true,
            next_page: "https://api.scryfall.com/cards/search?page=2",
          }),
        )
      : new Response("{}", { status: 503 }),
  );
  await assert.rejects(searchRemote("lore:urza"), /failed/);
  assert.equal(calls, 2);
});
test("a missing later search page cannot return partial results", async (t) => {
  const { searchRemote } = await import("../src/search.js");
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () =>
    ++calls === 1
      ? new Response(
          JSON.stringify({
            total_cards: 2,
            data: [{ id: "first" }],
            has_more: true,
            next_page: "https://api.scryfall.com/cards/search?page=2",
          }),
        )
      : new Response("{}", { status: 404 }),
  );
  await assert.rejects(searchRemote("lore:urza"), /later search page/);
});
