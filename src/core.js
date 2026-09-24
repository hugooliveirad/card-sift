export const FORMATS = {
  pauper: "Pauper",
  standard: "Standard",
  modern: "Modern",
  premodern: "Premodern",
  pioneer: "Pioneer",
  legacy: "Legacy",
  vintage: "Vintage",
  commander: "Commander",
  duel: "Duel Commander",
};
export const RARITIES = ["common", "uncommon", "rare", "mythic"];
export const DEFAULT_RULES = {
  formats: ["pauper", "modern", "premodern"],
  formatMode: "played",
  minShare: 1,
  playsets: "matched",
  copies: 4,
  landCopies: 4,
  keepJ25: false,
  rarity: "rare",
  priceEnabled: true,
  threshold: 2,
  currency: "usd",
  trustReference: false,
  preference: "cheapest",
  basics: 20,
};
export const norm = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
export const rowKey = (row) =>
  JSON.stringify([
    norm(row.name),
    row.set?.toLowerCase() || "",
    row.number || "",
    row.scryfallId || "",
    row.finish || "nonfoil",
  ]);
export const groupKey = (row) =>
  row.card?.oracle_id || norm(row.card?.name || row.name);
export const isLand = (row) => /\bLand\b/.test(row.card?.type_line || "");
export function reserveKey(row) {
  if (!isLand(row)) return groupKey(row);
  return isExact(row)
    ? `land:${row.card.id || row.card.set + ":" + row.card.collector_number}`
    : `unknown-land:${row.id}`;
}
export function tournamentHits(
  row,
  formats,
  snapshot,
  evidence = buildEvidence(snapshot),
) {
  return formats.flatMap((format) => {
    const hit = evidenceFor(row, format, evidence);
    return hit &&
      ["legal", "restricted"].includes(row.card?.legalities?.[format])
      ? [{ ...hit, format, url: snapshot.formats[format].url }]
      : [];
  });
}
export function validQuantity(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 && n <= 100000;
}
export function priceOf(row, currency) {
  const key =
    currency +
    (row.finish === "foil"
      ? "_foil"
      : row.finish === "etched"
        ? "_etched"
        : "");
  const value = row.card?.prices?.[key];
  return value !== null &&
    value !== undefined &&
    value !== "" &&
    Number.isFinite(Number(value)) &&
    Number(value) >= 0
    ? Number(value)
    : null;
}
export function isExact(row) {
  return Boolean(
    row.card &&
      ((row.scryfallId && row.scryfallId.toLowerCase() === row.card.id) ||
        (row.set &&
          row.number &&
          row.set.toLowerCase() === row.card.set &&
          row.number === row.card.collector_number)),
  );
}
export function buildEvidence(snapshot) {
  return Object.fromEntries(
    Object.entries(snapshot?.formats || {}).map(([format, data]) => [
      format,
      new Map(data.cards.map((card) => [norm(card.name), card])),
    ]),
  );
}
export function evidenceFor(row, format, evidence) {
  const name = row.card?.name || row.name;
  return (
    evidence[format]?.get(norm(name)) ||
    evidence[format]?.get(norm(name.split(" // ")[0]))
  );
}
export function analyze(rows, rules, snapshot, now = Date.now(), j25 = null) {
  const j25Names = new Set((j25?.names || []).map(norm));
  const evidence = buildEvidence(snapshot);
  const evidenceFresh =
    snapshot &&
    Number.isFinite(Date.parse(snapshot.fetchedAt)) &&
    now - Date.parse(snapshot.fetchedAt) < 35 * 86400000;
  const groups = new Map();
  const result = rows.map((row) => {
    const item = {
      ...row,
      keep: 0,
      bulk: 0,
      review: 0,
      reasons: [],
      uncertainties: [],
      played: tournamentHits(row, rules.formats, snapshot, evidence),
      eligible: false,
      price: priceOf(row, rules.currency),
      exact: isExact(row),
    };
    item.j25 = j25 ? j25Names.has(norm(row.card?.name || row.name)) : null;
    if (rules.keepJ25 && !row.override) {
      if (!j25)
        item.uncertainties.push(
          "J25 deck membership unavailable; reload to retry",
        );
      else if (item.j25) {
        item.eligible = Boolean(row.card);
        item.reasons.push(
          "Included in a Foundations Jumpstart (J25) deck, across printings",
        );
      }
    }
    item.tournamentShare = item.played.length
      ? Math.max(
          ...item.played.map((hit) => Math.max(hit.mainboard, hit.sideboard)),
        )
      : null;
    if (row.override === "keep") {
      item.keep = row.quantity;
      item.reasons.push("You chose to keep every copy");
    } else if (row.override === "bulk") {
      item.bulk = row.quantity;
      item.reasons.push("You chose bulk storage");
    } else {
      if (!row.card)
        item.uncertainties.push(row.lookupError || "Card details not loaded");
      else {
        if (!row.fetchedAt || now - row.fetchedAt > 7 * 86400000)
          item.uncertainties.push(
            "Card details older than 7 days; refresh before sorting",
          );
        if (rules.rarity !== "none") {
          if (!item.exact)
            item.uncertainties.push("Printing needed to confirm rarity");
          else if (!RARITIES.includes(row.card.rarity))
            item.uncertainties.push("Unrecognized printing rarity");
          else if (
            RARITIES.indexOf(row.card.rarity) >= RARITIES.indexOf(rules.rarity)
          ) {
            item.keep = row.quantity;
            item.reasons.push(`${row.card.rarity} printing protected`);
          }
        }
        if (rules.priceEnabled) {
          if (item.price === null)
            item.uncertainties.push(
              `No ${rules.currency.toUpperCase()} price for this finish`,
            );
          else if (!item.exact && !rules.trustReference)
            item.uncertainties.push(
              "Reference price only; exact printing needed",
            );
          else if (item.price >= rules.threshold) {
            item.keep = row.quantity;
            item.reasons.push(
              `At or above ${rules.currency.toUpperCase()} ${rules.threshold.toFixed(2)}`,
            );
          }
        }
        for (const format of rules.formats) {
          const legality = row.card.legalities?.[format];
          const legal = legality === "legal" || legality === "restricted";
          if (!legality)
            item.uncertainties.push(`${FORMATS[format]} legality unavailable`);
          if (!legal) continue;
          if (rules.formatMode === "legal") {
            item.eligible = true;
            item.reasons.push(`Legal in ${FORMATS[format]}`);
          } else {
            const hit = evidenceFor(row, format, evidence);
            if (
              hit &&
              Math.max(hit.mainboard, hit.sideboard) >= rules.minShare
            ) {
              item.eligible = true;
              const sections = [
                hit.mainboard >= rules.minShare
                  ? `${hit.mainboard}% of mainboards`
                  : "",
                hit.sideboard >= rules.minShare
                  ? `${hit.sideboard}% of sideboards`
                  : "",
              ].filter(Boolean);
              item.reasons.push(
                `${FORMATS[format]}: ${sections.join(" · ")}${evidenceFresh ? "" : " (older evidence)"}`,
              );
            } else if (!evidenceFresh || !evidence[format])
              item.uncertainties.push(
                `${FORMATS[format]} play evidence ${evidence[format] ? "needs refreshing" : "unavailable"}`,
              );
          }
        }
      }
    }
    const key = reserveKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
    return item;
  });
  for (const group of groups.values()) {
    const basic = group.some((r) => /\bBasic\b/.test(r.card?.type_line || ""));
    const eligible = group.some((r) => r.eligible);
    const land = group.some(isLand);
    const copies = land ? rules.landCopies : rules.copies;
    let target = basic
      ? rules.basics
      : rules.playsets === "all" || (rules.playsets === "matched" && eligible)
        ? copies
        : 0;
    if (land && target > 0 && !group.every(isExact)) {
      for (const item of group)
        item.uncertainties.push(
          "Exact land printing needed for its reserve; add a set and collector number or Scryfall ID",
        );
      target = 0;
    }
    // Copies protected by value, rarity, or a manual keep already satisfy the shared playset.
    target = Math.max(0, target - group.reduce((sum, r) => sum + r.keep, 0));
    const candidates = group
      .filter((r) => !r.override)
      .sort((a, b) => {
        if (rules.preference === "nonfoil" && a.finish !== b.finish)
          return (
            (a.finish === "nonfoil" ? -1 : 1) -
            (b.finish === "nonfoil" ? -1 : 1)
          );
        return (
          (a.price ?? Infinity) - (b.price ?? Infinity) ||
          a.id.localeCompare(b.id)
        );
      });
    for (const item of candidates) {
      const chosen = Math.min(target, item.quantity - item.keep);
      item.keep += chosen;
      target -= chosen;
      if (chosen)
        item.reasons.push(
          basic
            ? `Basic land reserve (${rules.basics} per printing)`
            : land
              ? `Land playset (${copies} per printing)`
              : `Playset reserve (${copies} across printings)`,
        );
      const remaining = item.quantity - item.keep;
      if (remaining) {
        if (item.uncertainties.length) item.review = remaining;
        else {
          item.bulk = remaining;
          item.reasons.push(
            item.keep || group.some((r) => r.keep)
              ? "Extra copies beyond your reserve"
              : "No keep rule matched",
          );
        }
      }
      if (
        !item.eligible &&
        rules.formatMode === "played" &&
        rules.formats.length &&
        !basic &&
        item.bulk
      )
        item.reasons.push(
          "No qualifying match in the sampled tournament cards",
        );
    }
  }
  return result;
}
export function mergeRows(existing, incoming) {
  const merged = new Map(existing.map((row) => [rowKey(row), { ...row }]));
  for (const row of incoming) {
    const key = rowKey(row),
      previous = merged.get(key);
    if (previous) {
      if (!validQuantity(previous.quantity + row.quantity))
        throw new Error(
          `Too many copies of ${row.name}; maximum is 100,000 per printing.`,
        );
      previous.quantity += row.quantity;
    } else merged.set(key, { ...row });
  }
  if (merged.size > 50000)
    throw new Error("A collection can contain at most 50,000 printing rows.");
  return [...merged.values()];
}
export function validateRules(input) {
  const r = { ...DEFAULT_RULES, ...input };
  if (
    !Array.isArray(r.formats) ||
    r.formats.some((f) => !Object.hasOwn(FORMATS, f))
  )
    throw new Error("Unsupported format in rules.");
  for (const [key, allowed] of Object.entries({
    formatMode: ["played", "legal"],
    playsets: ["all", "matched", "off"],
    rarity: ["none", ...RARITIES],
    currency: ["usd", "eur"],
    preference: ["cheapest", "nonfoil"],
  })) {
    if (!allowed.includes(r[key])) throw new Error(`Invalid ${key} rule.`);
  }
  for (const [key, max] of Object.entries({
    copies: 100,
    landCopies: 10000,
    basics: 10000,
    minShare: 100,
    threshold: 1000000,
  })) {
    if (
      !Number.isFinite(r[key]) ||
      r[key] < 0 ||
      r[key] > max ||
      (["copies", "landCopies", "basics"].includes(key) &&
        !Number.isInteger(r[key]))
    )
      throw new Error(`Invalid ${key} rule.`);
  }
  if (r.minShare < 1) throw new Error("Minimum deck share is 1%.");
  for (const key of ["priceEnabled", "trustReference", "keepJ25"])
    if (typeof r[key] !== "boolean") throw new Error(`Invalid ${key} rule.`);
  return r;
}
