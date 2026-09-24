import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  groupPrintings,
  ownedVersions,
  tournamentURL,
  ligaURL,
  isFoil,
} from "../src/display.js";

const row = (id, overrides = {}) => ({
  id,
  name: "Lightning Bolt",
  set: "m11",
  number: "146",
  finish: "nonfoil",
  quantity: 3,
  keep: 2,
  bulk: 1,
  review: 0,
  card: {
    id: "printing-a",
    oracle_id: "bolt",
    name: "Lightning Bolt",
    set: "m11",
    collector_number: "146",
  },
  ...overrides,
});

test("table joins finishes of the same printing and conserves allocations without mutating inventory", () => {
  const rows = [
    row("normal"),
    row("foil", { finish: "foil", quantity: 5, keep: 1, bulk: 2, review: 2 }),
  ];
  const before = structuredClone(rows);
  const [group] = groupPrintings(rows);
  assert.equal(group.versions.length, 2);
  assert.equal(group.quantity, 8);
  assert.deepEqual([group.keep, group.bulk, group.review], [3, 3, 2]);
  assert.equal(group.quantity, group.keep + group.bulk + group.review);
  assert.deepEqual(rows, before);
});

test("different printings and name-only reference matches stay separate", () => {
  const rows = [
    row("a"),
    row("b", { set: "lea", number: "161", card: { id: "printing-b" } }),
    row("unknown-normal", { set: "", number: "" }),
    row("unknown-foil", { set: "", number: "", finish: "foil" }),
  ];
  assert.equal(groupPrintings(rows).length, 4);
});

test("equivalent exact identifiers join; unresolved identifiers cannot conflate different card names", () => {
  assert.equal(
    groupPrintings([
      row("a"),
      row("b", {
        set: "",
        number: "",
        scryfallId: "printing-a",
        finish: "foil",
      }),
    ]).length,
    1,
  );
  assert.equal(
    groupPrintings([
      row("a", { card: null }),
      row("b", { card: null, name: "Counterspell" }),
    ]).length,
    2,
  );
});

test("all owned versions match Oracle identity or unresolved canonical name", () => {
  const selected = row("a");
  const versions = ownedVersions(selected, [
    selected,
    row("foil", { finish: "foil" }),
    row("unknown", { card: null, set: "" }),
    row("other", {
      name: "Other",
      card: { oracle_id: "other", name: "Other" },
    }),
  ]);
  assert.deepEqual(
    versions.map((v) => v.id),
    ["a", "foil", "unknown"],
  );
  assert.equal(isFoil({ finish: "etched" }), true);
  assert.equal(isFoil(selected), false);
});

test("external searches encode card names and use MTGTop8's format codes", () => {
  const u = new URL(tournamentURL("Fire // Ice", "duel"));
  assert.equal(u.searchParams.get("cards"), "Fire");
  assert.equal(u.searchParams.get("format"), "EDH");
  assert.equal(u.searchParams.get("MD_check"), "1");
  assert.equal(u.searchParams.get("SB_check"), "1");
  assert.equal(
    new URL(ligaURL('A & B "C"')).searchParams.get("card"),
    'A & B "C"',
  );
});

test("derived J25 memberships reference real decks with copy quantities", () => {
  const data = JSON.parse(
    readFileSync(new URL("../data/j25.json", import.meta.url)),
  );
  assert.equal(Object.keys(data.deckInfo).length, data.decks);
  assert.deepEqual(Object.keys(data.membership).sort(), [...data.names].sort());
  const totals = new Map();
  for (const memberships of Object.values(data.membership)) {
    for (const { deck, quantity } of memberships) {
      assert(data.deckInfo[deck]?.name);
      assert(Number.isSafeInteger(quantity) && quantity > 0);
      totals.set(deck, (totals.get(deck) || 0) + quantity);
    }
  }
  assert([...totals.values()].every((quantity) => quantity === 20));
  assert(
    data.membership["Serra Angel"].some(
      ({ deck }) => data.deckInfo[deck].name === "Angels",
    ),
  );
});
