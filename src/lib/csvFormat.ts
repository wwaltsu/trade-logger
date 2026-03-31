/** Detect export shape from header keys (first data row’s keys = header names). */
export type CsvKind = "activity" | "transaction_history";

export function detectCsvKind(sampleRow: Record<string, string>): CsvKind {
  const keys = new Set(Object.keys(sampleRow).map((k) => k.trim().toLowerCase()));
  if (keys.has("sub type") && keys.has("value") && keys.has("order #")) return "transaction_history";
  if (keys.has("symbol") && keys.has("description")) return "activity";
  return "activity";
}
