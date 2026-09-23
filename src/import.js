import { norm, validQuantity, mergeRows, validateRules } from "./core.js";
export const COLUMNS = {
  name: "Card name",
  quantity: "Quantity",
  set: "Set code",
  number: "Collector number",
  scryfallId: "Scryfall ID",
  finish: "Finish / foil",
};
const aliases = {
  name: ["name", "cardname", "card", "englishname"],
  quantity: ["quantity", "qty", "count", "owned", "amount", "totalquantity"],
  set: ["setcode", "set", "editioncode", "edition", "setid"],
  number: ["collectornumber", "cardnumber", "number", "cn"],
  scryfallId: ["scryfallid", "scryfalluuid"],
  finish: ["finish", "printing", "foil", "isfoil", "isfoiled"],
};
export function parseCSV(text) {
  text = text.replace(/^\uFEFF/, "");
  const first = text.split(/\r?\n/)[0];
  const delimiter = [",", ";", "\t"].sort(
    (a, b) => first.split(b).length - first.split(a).length,
  )[0];
  const rows = [];
  let row = [],
    cell = "",
    quoted = false,
    closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = "";
      closed = false;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      cell = "";
      closed = false;
    } else if (closed && c.trim())
      throw new Error(
        "Unexpected text after a quoted CSV field. Check the file and try again.",
      );
    else if (!closed) cell += c;
  }
  if (quoted)
    throw new Error("An opening quote has no closing quote in the CSV.");
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  if (rows.length < 2)
    throw new Error("The CSV needs a header and at least one card row.");
  if (rows.length > 50001)
    throw new Error("Choose a file with at most 50,000 card rows.");
  const headers = rows.shift().map((h) => h.trim());
  const mapping = Object.fromEntries(
    Object.entries(aliases).map(([key, names]) => [
      key,
      headers.findIndex((h) =>
        names.includes(h.toLowerCase().replace(/[^a-z]/g, "")),
      ),
    ]),
  );
  return { headers, rows, mapping, delimiter };
}
export function rowsFromCSV(parsed, mapping = parsed.mapping) {
  if (
    mapping.name < 0 &&
    mapping.scryfallId < 0 &&
    !(mapping.set >= 0 && mapping.number >= 0)
  )
    throw new Error(
      "Map a card name, Scryfall ID, or set code and collector number.",
    );
  const accepted = [],
    issues = [];
  parsed.rows.forEach((cells, index) => {
    const get = (key) =>
      mapping[key] >= 0 ? (cells[mapping[key]] || "").trim() : "";
    const quantity = mapping.quantity < 0 ? 1 : Number(get("quantity"));
    const name = get("name"),
      set = get("set").toLowerCase(),
      number = get("number"),
      scryfallId = get("scryfallId").toLowerCase();
    const rawFinish = norm(get("finish"));
    const finish = [
      "foil",
      "true",
      "yes",
      "1",
      "f",
      "f0",
      "traditional foil",
    ].includes(rawFinish)
      ? "foil"
      : ["etched", "etched foil"].includes(rawFinish)
        ? "etched"
        : [
              "",
              "nonfoil",
              "non-foil",
              "normal",
              "regular",
              "false",
              "no",
              "0",
            ].includes(rawFinish)
          ? "nonfoil"
          : null;
    let error =
      cells.length !== parsed.headers.length
        ? "Column count differs from the header"
        : !name && !scryfallId && !(set && number)
          ? "Missing card identifier"
          : !validQuantity(quantity)
            ? "Quantity must be a whole number from 1 to 100,000"
            : !finish
              ? "Unrecognized finish: " + rawFinish
              : scryfallId &&
                  !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(
                    scryfallId,
                  )
                ? "Invalid Scryfall ID"
                : null;
    if (error) issues.push({ row: index + 2, name, message: error });
    else
      accepted.push({
        id: crypto.randomUUID(),
        name: name || `${set.toUpperCase()} #${number || scryfallId}`,
        quantity,
        set,
        number,
        scryfallId,
        finish,
      });
  });
  return { rows: mergeRows([], accepted), issues };
}
export function parseDecklist(text) {
  const rows = [],
    issues = [];
  text.split(/\r?\n/).forEach((line, index) => {
    line = line.trim();
    if (
      !line ||
      /^\/\//.test(line) ||
      /^(deck|sideboard|commander|maybeboard|[\/]+.*)$/i.test(line)
    )
      return;
    const match = line.match(
      /^(\d+)x?\s+(.+?)(?:\s+\(([a-z\d]+)\)\s+([^\s]+))?(?:\s+(\*F\*|\*E\*))?$/i,
    );
    if (!match || !validQuantity(match[1]))
      issues.push({
        row: index + 1,
        name: line,
        message: "Use “4 Lightning Bolt” or “4 Lightning Bolt (M11) 149”.",
      });
    else
      rows.push({
        id: crypto.randomUUID(),
        quantity: Number(match[1]),
        name: match[2],
        set: (match[3] || "").toLowerCase(),
        number: match[4] || "",
        scryfallId: "",
        finish:
          match[5] === "*F*"
            ? "foil"
            : match[5] === "*E*"
              ? "etched"
              : "nonfoil",
      });
  });
  if (!rows.length && !issues.length)
    throw new Error("Paste at least one card.");
  return { rows: mergeRows([], rows), issues };
}
export function validateBackup(input) {
  if (
    input?.app !== "card-sift" ||
    input.schema !== 1 ||
    !Array.isArray(input.rows) ||
    input.rows.length > 50000
  )
    throw new Error("This is not a supported Card Sift backup.");
  const ids = new Set();
  const rows = input.rows.map((r) => {
    if (
      !r ||
      typeof r.name !== "string" ||
      !r.name.trim() ||
      r.name.length > 300 ||
      !validQuantity(r.quantity) ||
      !["nonfoil", "foil", "etched"].includes(r.finish) ||
      (r.override && !["keep", "bulk"].includes(r.override))
    )
      throw new Error(
        "A backup row has an invalid name, quantity, finish, or override.",
      );
    const row = {
      id:
        typeof r.id === "string" && !ids.has(r.id) ? r.id : crypto.randomUUID(),
      name: r.name,
      quantity: r.quantity,
      finish: r.finish,
    };
    ids.add(row.id);
    for (const key of ["set", "number", "scryfallId"])
      row[key] = typeof r[key] === "string" ? r[key] : "";
    if (r.override) row.override = r.override;
    // Re-fetch imported metadata; backups cannot supply trusted remote URLs or card facts.
    return row;
  });
  return { rows: mergeRows([], rows), rules: validateRules(input.rules) };
}
export function atlasBackup(input) {
  const inventory = input?.inventory || input?.collection?.inventory;
  if (!inventory || typeof inventory !== "object" || Array.isArray(inventory))
    throw new Error("No collection inventory found in this JSON file.");
  const rows = Object.entries(inventory)
    .filter(([, quantity]) => quantity !== 0)
    .map(([name, quantity]) => {
      if (!validQuantity(quantity))
        throw new Error("Invalid quantity for " + name);
      return {
        id: crypto.randomUUID(),
        name,
        quantity,
        set: "",
        number: "",
        scryfallId: "",
        finish: "nonfoil",
      };
    });
  return { rows: mergeRows([], rows), issues: [] };
}
export function csvText(headers, rows) {
  const escape = (value) =>
    '"' +
    String(value ?? "")
      .replace(/^[=+@\-\t\r]/, "'$&")
      .replaceAll('"', '""') +
    '"';
  return (
    "\uFEFF" +
    [headers, ...rows].map((row) => row.map(escape).join(",")).join("\r\n")
  );
}
