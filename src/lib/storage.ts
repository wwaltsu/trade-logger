import type { CompletedTrade } from "./engine";

const STORAGE_KEY = "trade-logger-journal-v1";
/** Previous branding; still read once so data is not lost. */
const LEGACY_STORAGE_KEY = "spreadbook-journal-v1";

type SerializedTrade = Omit<CompletedTrade, "openTs" | "closeTs"> & {
  openTs: string;
  closeTs: string;
};

export type StoredJournal = {
  fileName: string | null;
  trades: SerializedTrade[];
};

function serializeTrades(trades: CompletedTrade[]): SerializedTrade[] {
  return trades.map((t) => ({
    ...t,
    openTs: t.openTs.toISOString(),
    closeTs: t.closeTs.toISOString(),
  }));
}

function deserializeTrades(rows: SerializedTrade[]): CompletedTrade[] {
  return rows.map((t) => {
    const plNet = t.plNet;
    const totalFees = t.totalFees;
    const plGross =
      typeof t.plGross === "number" && !Number.isNaN(t.plGross) ? t.plGross : plNet + totalFees;
    return {
      ...t,
      plGross,
      openTs: new Date(t.openTs),
      closeTs: new Date(t.closeTs),
    };
  });
}

export function loadJournal(): StoredJournal | null {
  if (typeof window === "undefined") return null;
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as StoredJournal;
    if (!data || !Array.isArray(data.trades)) return null;
    return {
      fileName: data.fileName ?? null,
      trades: data.trades,
    };
  } catch {
    return null;
  }
}

export function saveJournal(fileName: string | null, trades: CompletedTrade[]): void {
  if (typeof window === "undefined") return;
  try {
    if (trades.length === 0 && !fileName) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      return;
    }
    const payload: StoredJournal = {
      fileName,
      trades: serializeTrades(trades),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* quota / private mode */
  }
}

export function clearJournalStorage(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
}

export function storedTradesToCompleted(rows: SerializedTrade[]): CompletedTrade[] {
  return deserializeTrades(rows);
}
