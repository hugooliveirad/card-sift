import { norm, priceOf, isExact, RARITIES } from "./core.js";
const aliases = {
  n: "name",
  t: "type",
  o: "oracle",
  fo: "oracle",
  c: "color",
  id: "identity",
  cmc: "mv",
  manavalue: "mv",
  r: "rarity",
  s: "set",
  e: "set",
  edition: "set",
  f: "format",
  legal: "format",
  pow: "power",
  tou: "toughness",
  loy: "loyalty",
  m: "mana",
  a: "artist",
  ft: "flavor",
  kw: "keyword",
};
const localFields = new Set([
  "text",
  "name",
  "type",
  "oracle",
  "color",
  "identity",
  "mv",
  "rarity",
  "set",
  "format",
  "banned",
  "restricted",
  "power",
  "toughness",
  "loyalty",
  "mana",
  "artist",
  "flavor",
  "keyword",
  "usd",
  "eur",
  "game",
  "is",
]);
const localIs = new Set([
  "owned",
  "keep",
  "bulk",
  "review",
  "j25",
  "foil",
  "nonfoil",
  "etched",
  "land",
  "nonland",
  "basic",
  "reprint",
  "vanilla",
]);
const collectionIs = new Set([
  "owned",
  "keep",
  "bulk",
  "review",
  "j25",
  "foil",
  "nonfoil",
  "etched",
]);
export const CARD_TYPES = [
  "Artifact",
  "Battle",
  "Creature",
  "Enchantment",
  "Instant",
  "Land",
  "Planeswalker",
  "Sorcery",
  "Tribal",
];
export function setMatches(row, query) {
  if (!query.trim()) return true;
  const code = row.set || (isExact(row) ? row.card?.set : "");
  if (!code) return false;
  const name = row.card?.set === code ? row.card.set_name : "";
  return norm(`${code} ${name || ""}`).includes(norm(query));
}
export function typeMatches(row, include = [], exclude = []) {
  if (!include.length && !exclude.length) return true;
  if (!row.card?.type_line) return false;
  const types = norm(row.card.type_line).split(" — ")[0].split(/\s+/);
  const has = (value) =>
    types.includes(norm(value)) ||
    (norm(value) === "tribal" && types.includes("kindred"));
  return (!include.length || include.some(has)) && !exclude.some(has);
}
export function compileQuery(query) {
  const tokens = [],
    terms = [];
  let i = 0,
    depth = 0;
  const lexer = /\s+|[()]|(?:[^\s()"]|"(?:\\.|[^"\\])*")+/gy;
  while (i < query.length) {
    lexer.lastIndex = i;
    const m = lexer.exec(query);
    if (!m) throw new Error("Close the quotation mark in your search.");
    i = lexer.lastIndex;
    if (m[0].trim()) tokens.push(m[0]);
  }
  if (tokens.length > 200) throw new Error("Use fewer than 200 search terms.");
  let cursor = 0;
  function primary() {
    const token = tokens[cursor++];
    if (!token) throw new Error("Add a search term after the operator.");
    if (token === "-" || token.toUpperCase() === "NOT")
      return { not: primary() };
    if (token === "(") {
      if (++depth > 32) throw new Error("Too many nested search groups.");
      const expression = or();
      if (tokens[cursor++] !== ")")
        throw new Error("Close the parenthesis in your search.");
      depth--;
      return expression;
    }
    if (token === ")" || /^(AND|OR)$/i.test(token))
      throw new Error("Add a search term before " + token + ".");
    if (token.startsWith("-") && token.length > 1) {
      cursor--;
      tokens[cursor] = token.slice(1);
      return { not: primary() };
    }
    const match = token.match(/^([a-z]+)(:|!=|<=|>=|=|<|>)(.*)$/i);
    const field = match
      ? aliases[match[1].toLowerCase()] || match[1].toLowerCase()
      : "text";
    const op = match ? match[2] : ":";
    let value = match ? match[3] : token;
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        throw new Error("Check the quoted search text.");
      }
    }
    if (!value) throw new Error("Add a value after " + field + op);
    const term = { field, op, value: norm(value) };
    terms.push(term);
    return { term };
  }
  function and() {
    let expression = primary();
    while (
      cursor < tokens.length &&
      tokens[cursor] !== ")" &&
      tokens[cursor].toUpperCase() !== "OR"
    ) {
      if (tokens[cursor].toUpperCase() === "AND") cursor++;
      expression = { and: [expression, primary()] };
    }
    return expression;
  }
  function or() {
    let expression = and();
    while (tokens[cursor]?.toUpperCase() === "OR") {
      cursor++;
      expression = { or: [expression, and()] };
    }
    return expression;
  }
  const ast = tokens.length ? or() : null;
  if (cursor < tokens.length)
    throw new Error("Unexpected closing parenthesis.");
  const requiresRemote = terms.some(
    (t) =>
      !localFields.has(t.field) ||
      t.field === "mana" ||
      t.value.startsWith("/") ||
      (["mv", "power", "toughness", "loyalty", "usd", "eur"].includes(
        t.field,
      ) &&
        !Number.isFinite(Number(t.value))) ||
      (t.field === "rarity" &&
        !["c", "u", "r", "m", ...RARITIES].includes(t.value)) ||
      (t.field === "is" && !localIs.has(t.value)),
  );
  const hasCollectionTerms = terms.some(
    (t) => t.field === "is" && collectionIs.has(t.value),
  );
  return { ast, terms, requiresRemote, hasCollectionTerms };
}
const compare = (actual, op, expected) =>
  actual === null ||
  actual === undefined ||
  !Number.isFinite(Number(actual)) ||
  !Number.isFinite(Number(expected))
    ? null
    : op === ">"
      ? Number(actual) > Number(expected)
      : op === "<"
        ? Number(actual) < Number(expected)
        : op === ">="
          ? Number(actual) >= Number(expected)
          : op === "<="
            ? Number(actual) <= Number(expected)
            : op === "!="
              ? Number(actual) !== Number(expected)
              : Number(actual) === Number(expected);
function matchTerm(row, { field, op, value }) {
  const card = row.card;
  const contains = (actual) =>
    actual === undefined || actual === null
      ? null
      : norm(actual).includes(value);
  switch (field) {
    case "text":
      return contains(
        `${row.name} ${card?.type_line || ""} ${card?.oracle_text || ""}`,
      );
    case "name":
      return op === "=" ? norm(row.name) === value : contains(row.name);
    case "type":
      return contains(card?.type_line?.replace(/Kindred/g, "Kindred Tribal"));
    case "oracle":
      return card
        ? norm(card.oracle_text || "").includes(
            value.replaceAll("~", norm(card.name || row.name)),
          )
        : null;
    case "mana":
      return card
        ? norm(card.mana_cost)
            .replace(/[{}]/g, "")
            .includes(value.replace(/[{}]/g, ""))
        : null;
    case "artist":
      return contains(card?.artist);
    case "flavor":
      return contains(card?.flavor_text);
    case "keyword":
      return card?.keywords
        ? card.keywords.some((k) => norm(k) === value)
        : null;
    case "game":
      return card?.games ? card.games.includes(value) : null;
    case "mv":
      return compare(card?.cmc, op, value);
    case "power":
    case "toughness":
    case "loyalty":
      return compare(card?.[field], op, value);
    case "usd":
    case "eur":
      return compare(priceOf(row, field), op, value);
    case "rarity": {
      if (!card?.rarity) return null;
      const expected =
        { c: "common", u: "uncommon", r: "rare", m: "mythic" }[value] || value;
      return compare(
        RARITIES.indexOf(card.rarity),
        op,
        RARITIES.indexOf(expected),
      );
    }
    case "set": {
      const code = row.set || (isExact(row) ? card?.set : "");
      if (!code) return null;
      return (
        norm(code) === value ||
        (card?.set === code && norm(card.set_name) === value)
      );
    }
    case "format":
    case "banned":
    case "restricted": {
      const f =
        { duelcommander: "duel", "pre-modern": "premodern" }[value] || value;
      const status = card?.legalities?.[f];
      if (!status) return null;
      return field === "format"
        ? ["legal", "restricted"].includes(status)
        : status === field;
    }
    case "color":
    case "identity": {
      const colors = field === "color" ? card?.colors : card?.color_identity;
      if (!colors) return null;
      const words = {
        white: "w",
        blue: "u",
        black: "b",
        red: "r",
        green: "g",
        colorless: "c",
        multicolor: "m",
        azorius: "wu",
        dimir: "ub",
        rakdos: "br",
        gruul: "rg",
        selesnya: "gw",
        orzhov: "wb",
        izzet: "ur",
        golgari: "bg",
        boros: "rw",
        simic: "gu",
        esper: "wub",
        grixis: "ubr",
        jund: "brg",
        naya: "rgw",
        bant: "gwu",
        abzan: "wbg",
        jeskai: "urw",
        sultai: "bgu",
        mardu: "rwb",
        temur: "gur",
      };
      const target = words[value] || value;
      if (/^\d+$/.test(target)) return compare(colors.length, op, target);
      if (target === "m") return colors.length > 1;
      const want = new Set(target.toUpperCase().replace(/C/g, "")),
        actual = new Set(colors);
      if ([...want].some((c) => !"WUBRG".includes(c))) return false;
      if (target === "c") return !actual.size;
      const subset = [...actual].every((c) => want.has(c)),
        superset = [...want].every((c) => actual.has(c));
      return op === "="
        ? subset && superset
        : op === "<="
          ? subset
          : op === "<"
            ? subset && actual.size < want.size
            : op === ">"
              ? superset && actual.size > want.size
              : op === "!="
                ? !(subset && superset)
                : superset;
    }
    case "is": {
      if (value === "owned") return row.quantity > 0;
      if (["keep", "bulk", "review"].includes(value)) return row[value] > 0;
      if (value === "j25") return row.j25;
      if (["foil", "nonfoil", "etched"].includes(value))
        return row.finish === value;
      if (!card) return null;
      if (value === "land") return /\bLand\b/.test(card.type_line);
      if (value === "nonland") return !/\bLand\b/.test(card.type_line);
      if (value === "basic") return /\bBasic\b/.test(card.type_line);
      if (value === "reprint") return card.reprint ?? null;
      if (value === "vanilla")
        return /\bCreature\b/.test(card.type_line) && !card.oracle_text;
      return null;
    }
    default:
      return null;
  }
}
export function matchesQuery(row, compiled) {
  function evaluate(node) {
    if (!node) return true;
    if (node.term) return matchTerm(row, node.term);
    if (node.not) {
      const value = evaluate(node.not);
      return value === null ? null : !value;
    }
    const values = (node.and || node.or).map(evaluate);
    return node.and
      ? values.includes(false)
        ? false
        : values.includes(null)
          ? null
          : true
      : values.includes(true)
        ? true
        : values.includes(null)
          ? null
          : false;
  }
  return evaluate(compiled.ast) === true;
}
export function advancedQuery(fields) {
  const quote = (value) => JSON.stringify(value.trim());
  const terms = [];
  for (const [field, token] of Object.entries({
    name: "name",
    oracle: "o",
    type: "t",
    mana: "m",
    artist: "a",
    flavor: "ft",
    lore: "lore",
    set: "set",
  })) {
    if (!fields[field]?.trim()) continue;
    if (field === "type")
      for (const t of fields[field].trim().split(/\s+/))
        terms.push(
          `${t.startsWith("-") ? "-" : ""}t:${quote(t.replace(/^-/, ""))}`,
        );
    else terms.push(`${token}:${quote(fields[field])}`);
  }
  if (fields.criteria?.trim())
    for (const t of fields.criteria.trim().split(/\s+/))
      terms.push(`${t.startsWith("-") ? "-" : ""}is:${t.replace(/^-/, "")}`);
  if (fields.colors?.length)
    terms.push(`c${fields.colorOp || ":"}${fields.colors.join("")}`);
  if (fields.identity?.length) terms.push(`id<=${fields.identity.join("")}`);
  if (fields.statValue != null && fields.statValue !== "")
    terms.push(
      `${fields.stat || "mv"}${fields.statOp || "="}${fields.statValue}`,
    );
  if (fields.format)
    terms.push(`${fields.formatStatus || "legal"}:${fields.format}`);
  if (fields.priceValue != null && fields.priceValue !== "")
    terms.push(
      `${fields.price || "usd"}${fields.priceOp || "<"}${fields.priceValue}`,
    );
  for (const [key, prefix] of [
    ["rarities", "r"],
    ["games", "game"],
  ])
    if (fields[key]?.length)
      terms.push(`(${fields[key].map((v) => `${prefix}:${v}`).join(" OR ")})`);
  return terms.join(" ");
}
let lastSearchRequest = 0;
export async function searchRemote(
  query,
  { signal, onProgress = () => {} } = {},
) {
  let url =
    "https://api.scryfall.com/cards/search?" +
    new URLSearchParams({ q: query, unique: "prints", order: "name" });
  const ids = new Set();
  while (url) {
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, 600 - (Date.now() - lastSearchRequest))),
    );
    signal?.throwIfAborted();
    lastSearchRequest = Date.now();
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.any(
        [signal, AbortSignal.timeout(20000)].filter(Boolean),
      ),
    });
    if (response.status === 404) {
      if (!ids.size) return ids;
      throw new Error(
        "A later search page was unavailable. Retry to get complete results.",
      );
    }
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        data.details ||
          "Scryfall search failed. Retry the search when connected.",
      );
    if (data.total_cards > 10000)
      throw new Error(
        "This online search matches over 10,000 printings. Add a set or another condition to narrow it.",
      );
    for (const card of data.data) ids.add(card.id);
    onProgress(ids.size);
    url = data.has_more ? data.next_page : null;
    if (url) {
      if (!url.startsWith("https://api.scryfall.com/cards/search?"))
        throw new Error("Unexpected search pagination URL.");
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }
  return ids;
}
