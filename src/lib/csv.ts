export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    if (row.length > 1 || (row.length === 1 && row[0] !== "")) rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const c = text[i]!;

    if (inQuotes) {
      if (c === '"') {
        const next = text[i + 1];
        if (next === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (c === ",") {
      pushField();
      i += 1;
      continue;
    }

    if (c === "\r") {
      i += 1;
      continue;
    }

    if (c === "\n") {
      pushField();
      pushRow();
      i += 1;
      continue;
    }

    field += c;
    i += 1;
  }

  pushField();
  if (row.some((x) => x.length > 0)) pushRow();

  return rows;
}

import { detectCsvKind } from "./csvFormat";

export function parseTastyCsv(text: string): Record<string, string>[] {
  const rows = parseCsvRows(text.trim());
  if (rows.length < 2) return [];
  const header = rows[0]!.map((h) => h.trim());
  const out: Record<string, string>[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r]!;
    const rec: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) rec[header[c]!] = cells[c] ?? "";
    out.push(rec);
  }
  return out;
}

function stableRowKey(r: Record<string, string>): string {
  if (detectCsvKind(r) === "transaction_history") {
    return [
      r.Date,
      r["Order #"],
      r.Symbol,
      r.Value,
      r["Strike Price"],
      r["Sub Type"],
    ].join("|");
  }
  return [
    r.Symbol,
    r.Status,
    r.Time,
    r["Order #"],
    r.MarketOrFill,
    r.Description?.slice(0, 200),
  ].join("|");
}

/** Drop exact duplicate lines (re-exports, copy-paste noise). */
export function dedupeCsvRows(rows: Record<string, string>[]): Record<string, string>[] {
  const seen = new Set<string>();
  const out: Record<string, string>[] = [];
  for (const r of rows) {
    const k = stableRowKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}
