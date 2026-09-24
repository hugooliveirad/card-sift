import test from "node:test";
import assert from "node:assert/strict";
import {
  analyze,
  DEFAULT_RULES,
  mergeRows,
  priceOf,
  validateRules,
} from "../src/core.js";
import {
  parseCSV,
  rowsFromCSV,
  parseDecklist,
  validateBackup,
  atlasBackup,
  csvText,
} from "../src/import.js";
const now = Date.now();
const snapshot = {
  fetchedAt: new Date(now).toISOString(),
  formats: {
    pauper: {
      url: "https://www.mtgtop8.com/",
      cards: [{ name: "Lightning Bolt", mainboard: 23.2, sideboard: 2.3 }],
    },
  },
};
function row(overrides = {}) {
  return {
    id: "a",
    name: "Lightning Bolt",
    quantity: 8,
    set: "m11",
    number: "149",
    finish: "nonfoil",
    fetchedAt: now,
    card: {
      id: "printing-a",
      oracle_id: "oracle-bolt",
      name: "Lightning Bolt",
      set: "m11",
      collector_number: "149",
      rarity: "common",
      prices: { usd: "0.50", usd_foil: "8.00", eur: null },
      legalities: { pauper: "legal", modern: "legal" },
      type_line: "Instant",
    },
    ...overrides,
  };
}
function rules(overrides = {}) {
  return {
    ...DEFAULT_RULES,
    formats: ["pauper"],
    rarity: "none",
    ...overrides,
  };
}
const plan = (rows, opts = {}, data = snapshot) =>
  analyze(rows, rules(opts), data, now);
function conserved(result) {
  for (const r of result) {
    assert.equal(r.keep + r.bulk + r.review, r.quantity);
    assert.ok(
      [r.keep, r.bulk, r.review].every((n) => Number.isInteger(n) && n >= 0),
    );
  }
}

test("reserves one shared playset across printings and sends duplicate copies to bulk", () => {
  const a = row({ quantity: 2 }),
    b = row({
      id: "b",
      quantity: 8,
      set: "m10",
      card: {
        ...row().card,
        id: "printing-b",
        set: "m10",
        prices: { usd: "1.00" },
      },
    });
  const result = plan([a, b]);
  assert.deepEqual(
    result.map((r) => [r.keep, r.bulk, r.review]),
    [
      [2, 0, 0],
      [2, 6, 0],
    ],
  );
  conserved(result);
});
test("protected rare and valuable copies satisfy the shared playset", () => {
  const rare = row({
      id: "rare",
      quantity: 3,
      card: { ...row().card, rarity: "rare" },
    }),
    cheap = row({ id: "cheap", quantity: 8 });
  const result = plan([cheap, rare], { rarity: "rare" });
  assert.deepEqual(
    result.map((r) => [r.keep, r.bulk]),
    [
      [1, 7],
      [3, 0],
    ],
  );
  const valuable = plan([row({ quantity: 10, finish: "foil" })]);
  assert.equal(valuable[0].keep, 10);
  conserved(valuable);
});
test("format legality alone does not count as play evidence", () => {
  const unknown = row({
    name: "Other card",
    card: { ...row().card, name: "Other card" },
  });
  assert.equal(plan([unknown])[0].bulk, 8);
  assert.equal(plan([unknown], { formatMode: "legal" })[0].keep, 4);
});
test("banned cards do not qualify even with positive tournament evidence", () => {
  const card = row({
    card: { ...row().card, legalities: { pauper: "banned" } },
  });
  assert.equal(plan([card])[0].keep, 0);
});
test("sideboard evidence qualifies without adding mainboard and sideboard percentages", () => {
  const data = structuredClone(snapshot);
  data.formats.pauper.cards[0] = {
    name: "Lightning Bolt",
    mainboard: 1.5,
    sideboard: 2.5,
  };
  assert.equal(plan([row()], { minShare: 3 }, data)[0].keep, 0);
  assert.equal(plan([row()], { minShare: 2 }, data)[0].keep, 4);
});
test("unknown card, missing price, ambiguous printing, and stale data stay in review", () => {
  for (const input of [
    row({ card: null }),
    row({ card: { ...row().card, prices: { usd: null } } }),
    row({ set: "", number: "" }),
    row({ fetchedAt: now - 8 * 86400000 }),
  ]) {
    const r = plan([input])[0];
    assert.ok(r.review > 0);
    assert.equal(r.bulk, 0);
    conserved([r]);
  }
  assert.equal(
    plan([row({ set: "", number: "" })], { trustReference: true })[0].bulk,
    4,
  );
  assert.equal(
    plan([row({ set: "", number: "" })], {
      trustReference: true,
      rarity: "rare",
    })[0].review,
    4,
  );
});
test("missing/old format evidence does not mark absent cards as bulk", () => {
  const old = {
    ...snapshot,
    fetchedAt: new Date(now - 40 * 86400000).toISOString(),
  };
  const absent = row({
    name: "Other card",
    card: { ...row().card, name: "Other card" },
  });
  assert.equal(plan([absent], {}, old)[0].review, 8);
  assert.equal(plan([absent], {}, null)[0].review, 8);
  assert.equal(plan([row()], { formats: ["modern"] })[0].review, 8);
});
test("manual keep and bulk take priority, and manual kept copies count toward playset", () => {
  const result = plan([
    row({ id: "pinned", quantity: 3, override: "keep" }),
    row({ id: "extra", quantity: 8 }),
    row({ id: "bulk", quantity: 9, override: "bulk", card: null }),
  ]);
  assert.deepEqual(
    result.map((r) => [r.keep, r.bulk]),
    [
      [3, 0],
      [1, 7],
      [0, 9],
    ],
  );
  conserved(result);
});
test("basic lands have a separate reserve; every-name and no-reserve modes work", () => {
  const basic = row({
    name: "Forest",
    quantity: 50,
    card: { ...row().card, name: "Forest", type_line: "Basic Land — Forest" },
  });
  assert.equal(plan([basic])[0].keep, 20);
  assert.equal(plan([row()], { playsets: "off" })[0].keep, 0);
  assert.equal(plan([row({ card: null })], { playsets: "all" })[0].keep, 4);
});
test("nonfoil preference overrides price ordering for playset allocation", () => {
  const foil = row({
    id: "foil",
    finish: "foil",
    card: { ...row().card, prices: { usd_foil: "0.01" } },
  });
  const result = plan([foil, row()], {
    preference: "nonfoil",
    priceEnabled: false,
  });
  assert.equal(result[1].keep, 4);
  assert.equal(result[0].keep, 0);
});
test("prices are specific to finish and currency; missing is distinct from zero", () => {
  assert.equal(priceOf(row({ finish: "foil" }), "usd"), 8);
  assert.equal(priceOf(row(), "eur"), null);
  assert.equal(priceOf(row({ finish: "etched" }), "eur"), null);
  assert.equal(priceOf(row({ card: { prices: { usd: "0" } } }), "usd"), 0);
});
test("quantity conservation for varied copy counts and reserves", () => {
  for (let copies = 0; copies < 10; copies++)
    for (let a = 1; a < 15; a++) {
      const result = plan(
        [row({ quantity: a }), row({ id: "b", quantity: 17 })],
        { copies },
      );
      conserved(result);
      assert.equal(
        result.reduce((s, r) => s + r.keep, 0),
        Math.min(copies, a + 17),
      );
    }
});
test("CSV handles quoted commas, multiline fields, BOM, tabs and semicolons", () => {
  const parsed = parseCSV(
    '\uFEFFName,Quantity,Set Code,Collector Number,Finish\r\n"Thalia, Guardian of Thraben",4,dka,24,foil\r\n"Fire\nIce",2,mh2,290,normal',
  );
  const r = rowsFromCSV(parsed);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].name, "Thalia, Guardian of Thraben");
  assert.equal(r.rows[0].finish, "foil");
  assert.equal(
    rowsFromCSV(parseCSV("Name;Qty\nLightning Bolt;8")).rows[0].quantity,
    8,
  );
  assert.equal(
    rowsFromCSV(parseCSV("Card Name\tCount\nCounterspell\t4")).rows[0].quantity,
    4,
  );
});
test("CSV rejects bad quantities and finish without silently rounding or dropping", () => {
  const r = rowsFromCSV(
    parseCSV(
      "Name,Quantity,Finish\nBolt,2.5,normal\nBolt,-1,normal\nBolt,,normal\nBolt,2,gold\nBolt,4,nonfoil",
    ),
  );
  assert.equal(r.issues.length, 4);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].quantity, 4);
  assert.throws(() => parseCSV('Name,Quantity\n"Bolt,4'), /closing quote/);
});
test("CSV without quantity assumes one and reports inconsistent column counts", () => {
  const result = rowsFromCSV(parseCSV("Name\nBolt\nCounterspell,2"));
  assert.equal(result.rows[0].quantity, 1);
  assert.equal(result.issues.length, 1);
});
test("imports combine identical rows but retain separate printings and finishes", () => {
  const r = rowsFromCSV(
    parseCSV(
      "Name,Quantity,Set,Collector Number,Finish\nBolt,3,m11,149,nonfoil\nBolt,2,m11,149,nonfoil\nBolt,4,m11,149,foil\nBolt,4,m10,149,nonfoil",
    ),
  );
  assert.deepEqual(
    r.rows.map((r) => r.quantity),
    [5, 4, 4],
  );
  assert.throws(
    () => mergeRows([row({ quantity: 100000 })], [row()]),
    /Too many/,
  );
});
test("decklists keep exact printing/finish and report malformed lines", () => {
  const r = parseDecklist(
    "Deck\n8 Lightning Bolt (M11) 149\n4 Counterspell\n2 Sol Ring (CMM) 396 *F*\nSideboard\ninvalid",
  );
  assert.equal(r.rows[0].name, "Lightning Bolt");
  assert.equal(r.rows[0].number, "149");
  assert.equal(r.rows[2].finish, "foil");
  assert.equal(r.issues.length, 1);
});
test("backup validates schema and rules; untrusted metadata is not restored", () => {
  const saved = validateBackup({
    app: "card-sift",
    schema: 1,
    rows: [row()],
    rules: rules(),
  });
  assert.equal(saved.rows[0].card, undefined);
  assert.throws(
    () => validateBackup({ app: "card-sift", schema: 2, rows: [] }),
    /supported/,
  );
  assert.throws(() => validateRules({ formats: ["fake"] }), /format/);
  assert.throws(() => validateRules({ threshold: -1 }), /threshold/);
  assert.equal(
    atlasBackup({ inventory: { "lightning bolt": 8, forest: 0 } }).rows.length,
    1,
  );
});
test("CSV exports quote text and neutralize spreadsheet formulas", () => {
  const text = csvText(["Name"], [["=BAD()"], ["Thalia, Guardian"]]);
  assert.match(text, /"'=BAD\(\)"/);
  assert.match(text, /"Thalia, Guardian"/);
});

test("conflicting names and printing identifiers remain unresolved", async () => {
  const { applyCard } = await import("../src/data.js");
  const card = row();
  assert.equal(
    applyCard(card, {
      card: { name: "Inferno Titan", names: ["Inferno Titan"] },
      fetchedAt: now,
    }),
    false,
  );
  assert.equal(card.name, "Lightning Bolt");
  assert.equal(card.card, undefined);
  assert.match(card.lookupError, /disagree/);
  assert.equal(plan([card])[0].review, 8);
});
test("identifier-only rows and split-card face names resolve correctly", async () => {
  const { applyCard } = await import("../src/data.js");
  const card = row({ name: "M11 #149" });
  assert.equal(
    applyCard(card, {
      card: { name: "Lightning Bolt", names: ["Lightning Bolt"] },
      fetchedAt: now,
    }),
    true,
  );
  assert.equal(card.name, "Lightning Bolt");
  const split = row({ name: "Fire" });
  assert.equal(
    applyCard(split, {
      card: { name: "Fire // Ice", names: ["Fire // Ice", "Fire", "Ice"] },
      fetchedAt: now,
    }),
    true,
  );
  assert.equal(split.name, "Fire // Ice");
});

function land(id, quantity, options = {}) {
  const {
    set = "tst",
    number = id,
    basic = false,
    finish = "nonfoil",
    ...extra
  } = options;
  return row({
    id,
    quantity,
    set,
    number,
    finish,
    name: "Test Land",
    card: {
      ...row().card,
      id: `land-${set}-${number}`,
      name: "Test Land",
      oracle_id: "same-land",
      set,
      collector_number: number,
      type_line: basic ? "Basic Land — Forest" : "Land",
      prices: { usd: "0.1", usd_foil: "0.2" },
    },
    ...extra,
  });
}
test("land playsets are independent per exact printing, across finishes and identifier styles", () => {
  const a = land("a", 3, { set: "one", number: "1" }),
    b = land("b", 9, { set: "two", number: "2" }),
    foil = land("foil", 4, { set: "one", number: "1", finish: "foil" });
  foil.scryfallId = foil.card.id;
  foil.set = "";
  foil.number = "";
  const result = plan([a, b, foil], {
    playsets: "all",
    copies: 1,
    landCopies: 5,
    priceEnabled: false,
  });
  assert.deepEqual(
    result.map((r) => [r.keep, r.bulk]),
    [
      [3, 0],
      [5, 4],
      [2, 2],
    ],
  );
  conserved(result);
});
test("basic land reserves also use exact printings, and unknown land printings need review", () => {
  const result = plan(
    [land("a", 30, { basic: true }), land("b", 30, { basic: true })],
    { basics: 12 },
  );
  assert.deepEqual(
    result.map((r) => r.keep),
    [12, 12],
  );
  conserved(result);
  const unknown = land("unknown", 30, { basic: true });
  unknown.set = "";
  unknown.number = "";
  const r = plan([unknown], { priceEnabled: false })[0];
  assert.equal(r.keep, 0);
  assert.equal(r.review, 30);
});
test("protected land copies count only toward that printing reserve", () => {
  const result = plan([land("a", 8, { override: "keep" }), land("b", 8)], {
    playsets: "all",
    landCopies: 3,
  });
  assert.deepEqual(
    result.map((r) => [r.keep, r.bulk]),
    [
      [8, 0],
      [3, 5],
    ],
  );
});
test("old rules and backups gain additive land and J25 defaults", () => {
  const { landCopies, keepJ25, ...oldRules } = rules();
  const restored = validateRules(oldRules);
  assert.equal(restored.landCopies, 4);
  assert.equal(restored.keepJ25, false);
  assert.throws(
    () => validateRules({ ...restored, landCopies: 2.5 }),
    /landCopies/,
  );
});
test("Duel Commander evidence has its own legality and ranks independently of keep decisions", () => {
  const data = {
    ...snapshot,
    formats: {
      duel: {
        url: "https://www.mtgtop8.com/",
        cards: [{ name: "Lightning Bolt", mainboard: 42, sideboard: 0 }],
      },
    },
  };
  const card = row({
    override: "bulk",
    card: { ...row().card, legalities: { duel: "legal", commander: "banned" } },
  });
  const r = plan(
    [card],
    { formats: ["duel"], minShare: 50, formatMode: "legal" },
    data,
  )[0];
  assert.equal(r.tournamentShare, 42);
  assert.equal(r.played[0].format, "duel");
  assert.equal(r.bulk, 8);
  const automatic = plan(
    [{ ...card, override: undefined }],
    { formats: ["duel"] },
    data,
  )[0];
  assert.equal(automatic.keep, 4);
});
test("J25 membership qualifies other-set copies and obeys playset limits", () => {
  const data = { names: ["Lightning Bolt"] };
  const result = analyze(
    [
      row({ id: "one", quantity: 3 }),
      row({
        id: "two",
        quantity: 7,
        set: "other",
        card: { ...row().card, set: "other" },
      }),
    ],
    rules({ formats: [], keepJ25: true }),
    snapshot,
    now,
    data,
  );
  assert.equal(
    result.reduce((s, r) => s + r.keep, 0),
    4,
  );
  assert.ok(result.every((r) => r.j25));
  assert.ok(result[0].reasons.some((r) => r.includes("J25")));
  conserved(result);
  const off = analyze(
    [row()],
    rules({ formats: [], keepJ25: false }),
    snapshot,
    now,
    data,
  );
  assert.equal(off[0].keep, 0);
});
test("missing J25 membership does not silently bulk cards with that keep rule enabled", () => {
  const result = analyze(
    [row()],
    rules({ formats: [], keepJ25: true }),
    snapshot,
    now,
    null,
  );
  assert.equal(result[0].review, 8);
});
test("J25 land matches still use separate land printing reserves", () => {
  const result = analyze(
    [land("a", 8), land("b", 8)],
    rules({ formats: [], keepJ25: true, landCopies: 2 }),
    snapshot,
    now,
    { names: ["Test Land"] },
  );
  assert.deepEqual(
    result.map((r) => r.keep),
    [2, 2],
  );
  conserved(result);
});
