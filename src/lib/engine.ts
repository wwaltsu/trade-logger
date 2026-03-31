export type Config = {
  defaultYear: number;
  exportFallback: Date;
  /** Activity CSV only: modeled $/contract RT if transaction history is not used. */
  feePerContractRT: number;
};

export type Leg = {
  qty: number;
  month: string;
  day: number;
  dteToken: string;
  strike: number;
  right: "Call" | "Put";
  action: "BTC" | "BTO" | "STC" | "STO";
};

export type CompletedTrade = {
  id: string;
  symbol: string;
  strategy: string;
  openTs: Date;
  closeTs: Date;
  dteAtOpen: number;
  dteChartBucket: "0" | "1–2" | "3–5" | "6–7" | "8+";
  strikesLabel: string;
  contracts: number;
  /** Net premium received at open per share (+ credit, − debit). */
  entryPerShare: number;
  /** Closing leg net premium per share (signed). */
  exitPerShare: number;
  entryCreditDisplay: string;
  exitDisplay: string;
  /** Premium P/L before modeled round-trip fees. */
  plGross: number;
  totalFees: number;
  /** P/L after subtracting modeled fees (this is what win/loss and charts use). */
  plNet: number;
  maxRisk: number;
  returnOnRiskPct: number;
  win: boolean;
};

export const LEG_RE =
  /^([+-]?\d+)\s+(\w+)\s+(\d+)\s+(?:(\d+)d|Exp)\s+(\d+)\s+(Call|Put)\s+(BTC|BTO|STC|STO)\s*$/i;

const MONTHS: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Tasty \"4/02/26\" expiration cells → leg month token + day. */
export function parseExpMdYToLegMonthDay(
  s: string,
  centuryAnchorYear: number,
): { month: string; day: number } | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const mo = parseInt(m[1]!, 10) - 1;
  const day = parseInt(m[2]!, 10);
  let y = parseInt(m[3]!, 10);
  if (y < 100) y += Math.floor(centuryAnchorYear / 100) * 100;
  if (mo < 0 || mo > 11) return null;
  return { month: MONTH_NAMES[mo]!, day };
}

export function parseLegLine(line: string): Leg | null {
  const m = line.trim().match(LEG_RE);
  if (!m) return null;
  const qty = parseInt(m[1]!, 10);
  const month = m[2]!.slice(0, 1).toUpperCase() + m[2]!.slice(1).toLowerCase();
  const day = parseInt(m[3]!, 10);
  const dteToken = m[4] != null ? `${m[4]}d` : "Exp";
  const strike = parseInt(m[5]!, 10);
  const right = (m[6]!.toLowerCase() === "put" ? "Put" : "Call") as Leg["right"];
  const action = m[7]!.toUpperCase() as Leg["action"];
  return { qty, month, day, dteToken, strike, right, action };
}

export function parseLegsFromDescription(desc: string): Leg[] {
  const lines = desc
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const legs: Leg[] = [];
  for (const line of lines) {
    const leg = parseLegLine(line);
    if (leg) legs.push(leg);
  }
  return legs;
}

export function legExpiryDate(leg: Leg, year: number): Date {
  const mi = MONTHS[leg.month];
  if (mi === undefined) return new Date(year, 0, 1);
  return new Date(year, mi, leg.day, 12, 0, 0, 0);
}

export function parsePremium(marketOrFill: string): number {
  const s = marketOrFill.trim().toLowerCase();
  const m = s.match(/^([\d.]+)\s*(cr|db)\s*$/);
  if (!m) return 0;
  const n = parseFloat(m[1]!);
  if (Number.isNaN(n)) return 0;
  return m[2] === "cr" ? n : -n;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Parse "M/D, h:mma" into Date using year from cfg. */
function dateFromSlashCell(raw: string, defaultYear: number): Date | null {
  const dm = raw
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2}),\s*(\d{1,2}):(\d{2})(?::(\d{2}))?([ap])$/i);
  if (!dm) return null;
  const mo = parseInt(dm[1]!, 10) - 1;
  const d = parseInt(dm[2]!, 10);
  let h = parseInt(dm[3]!, 10);
  const min = parseInt(dm[4]!, 10);
  const sec = dm[5] ? parseInt(dm[5], 10) : 0;
  const ap = dm[6]!.toLowerCase();
  if (ap === "p" && h < 12) h += 12;
  if (ap === "a" && h === 12) h = 0;
  return new Date(defaultYear, mo, d, h, min, sec, 0);
}

export function parseTime(timeCell: string, anchorDay: Date, defaultYear: number): Date {
  const raw = timeCell.trim();
  const full = dateFromSlashCell(raw, defaultYear);
  if (full) return full;
  const tm = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?([ap])$/i);
  if (tm) {
    let h = parseInt(tm[1]!, 10);
    const min = parseInt(tm[2]!, 10);
    const sec = tm[3] ? parseInt(tm[3], 10) : 0;
    const ap = tm[4]!.toLowerCase();
    if (ap === "p" && h < 12) h += 12;
    if (ap === "a" && h === 12) h = 0;
    return new Date(
      anchorDay.getFullYear(),
      anchorDay.getMonth(),
      anchorDay.getDate(),
      h,
      min,
      sec,
      0,
    );
  }
  return new Date(anchorDay);
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function dteOnDate(expiry: Date, asOf: Date): number {
  const a = startOfDay(asOf).getTime();
  const e = startOfDay(expiry).getTime();
  return Math.round((e - a) / 86400000);
}

export function dteChartBucket(dte: number): CompletedTrade["dteChartBucket"] {
  if (dte <= 0) return "0";
  if (dte <= 2) return "1–2";
  if (dte <= 5) return "3–5";
  if (dte <= 7) return "6–7";
  return "8+";
}

function sameExpiry(legs: Leg[]): boolean {
  if (legs.length === 0) return false;
  const k = `${legs[0]!.month}-${legs[0]!.day}`;
  return legs.every((l) => `${l.month}-${l.day}` === k);
}

export function formatPremiumSigned(n: number): string {
  const abs = Math.abs(n).toFixed(2);
  if (n >= 0) return `${abs} cr`;
  return `${abs} db`;
}

export function refineStrategy(legs: Leg[], openSigned: number): string {
  if (legs.length === 0) return "Unknown";
  if (legs.every((l) => l.action === "STC" || l.action === "BTC")) return "Close";
  if (!sameExpiry(legs)) return "Multi-expiry";
  const puts = legs.filter((l) => l.right === "Put");
  const calls = legs.filter((l) => l.right === "Call");
  if (puts.length === 2 && calls.length === 2 && legs.length === 4)
    return "Iron Condor";
  if (legs.length === 1) {
    const l = legs[0]!;
    return `${l.right} ${l.action}`;
  }
  if (legs.length !== 2) return "Multi-leg";

  const [a, b] = legs;
  if (a.right !== b.right) return "Mixed";

  const shortLeg = legs.find((l) => l.action === "STO");
  const longLeg = legs.find((l) => l.action === "BTO");
  if (!shortLeg || !longLeg) {
    const credit = openSigned >= 0;
    return `${a.right === "Put" ? "Put" : "Call"} ${credit ? "Credit" : "Debit"}`;
  }

  const credit = openSigned >= 0;
  if (a.right === "Put") {
    if (credit && shortLeg.strike > longLeg.strike) return "Bull Put Spread";
    if (!credit) return "Put Debit Spread";
    return "Put Spread";
  }
  if (a.right === "Call") {
    if (credit && shortLeg.strike < longLeg.strike) return "Bear Call Spread";
    if (!credit) return "Call Debit Spread";
    return "Call Spread";
  }
  return "Unknown";
}

export function strikesLabel(legs: Leg[]): string {
  if (legs.length === 0) return "—";
  const puts = legs.filter((l) => l.right === "Put");
  const calls = legs.filter((l) => l.right === "Call");
  if (puts.length === 2 && calls.length === 2) {
    const ps = [...new Set(puts.map((l) => l.strike))].sort((x, y) => x - y);
    const cs = [...new Set(calls.map((l) => l.strike))].sort((x, y) => x - y);
    return `${cs.map(String).join("/")} C · ${ps.map(String).join("/")} P`;
  }
  const s = [...new Set(legs.map((l) => l.strike))].sort((x, y) => x - y);
  return s.join("/");
}

export function maxRiskForOpen(legs: Leg[], openSigned: number, contracts: number): number {
  const n = Math.max(1, contracts);
  const mult = 100 * n;
  if (legs.length === 2 && sameExpiry(legs) && legs[0]!.right === legs[1]!.right) {
    const width = Math.abs(legs[0]!.strike - legs[1]!.strike);
    if (openSigned >= 0) {
      const riskPerShare = Math.max(0.01, width - openSigned);
      return riskPerShare * mult;
    }
    const debit = Math.max(0.01, -openSigned);
    return debit * mult;
  }
  if (legs.length === 4) {
    const puts = legs.filter((l) => l.right === "Put");
    const calls = legs.filter((l) => l.right === "Call");
    if (puts.length === 2 && calls.length === 2) {
      const ps = puts.map((l) => l.strike).sort((x, y) => x - y);
      const cs = calls.map((l) => l.strike).sort((x, y) => x - y);
      const putW = ps[1]! - ps[0]!;
      const callW = cs[1]! - cs[0]!;
      const wing = Math.max(putW, callW);
      const credit = Math.max(0, openSigned);
      return Math.max(1, wing - credit) * mult;
    }
  }
  return Math.max(1, Math.abs(openSigned) * mult) || 1;
}

export function fifoKey(symbol: string, legs: Leg[], cfg: Config): string {
  if (legs.length === 0) return `${symbol}|empty`;
  if (legs.length === 1) {
    const l = legs[0]!;
    const ex = legExpiryDate(l, cfg.defaultYear);
    return `${symbol}|${ex.toISOString().slice(0, 10)}|${l.right}|K${l.strike}`;
  }
  const e0 = legs[0]!;
  const ex = legExpiryDate(e0, cfg.defaultYear);
  const exKey = ex.toISOString().slice(0, 10);
  const sameRight = legs.every((l) => l.right === e0.right);
  if (sameRight) {
    const strikes = legs.map((l) => l.strike).sort((a, b) => a - b);
    return `${symbol}|${exKey}|${e0.right}|${strikes.join("-")}`;
  }
  const mixedSig = legs
    .map((l) => `${l.right === "Call" ? "C" : "P"}${l.strike}`)
    .sort()
    .join(".");
  return `${symbol}|${exKey}|mix|${mixedSig}`;
}

export function isOpenEvent(legs: Leg[]): boolean {
  if (legs.length === 0) return false;
  return legs.every((l) => l.action === "STO" || l.action === "BTO");
}

export function isCloseEvent(legs: Leg[]): boolean {
  return legs.some((l) => l.action === "BTC" || l.action === "STC");
}

export function eventContracts(legs: Leg[]): number {
  if (legs.length === 0) return 1;
  return Math.max(...legs.map((l) => Math.abs(l.qty)));
}

export function dedupeLegsForSpread(legs: Leg[]): Leg[] {
  const m = new Map<string, Leg>();
  for (const l of legs) {
    const k = `${l.month}-${l.day}|${l.strike}|${l.right}|${l.action}`;
    const prev = m.get(k);
    if (!prev) m.set(k, { ...l });
    else
      m.set(k, {
        ...prev,
        qty: prev.qty + l.qty,
      });
  }
  return [...m.values()].filter((l) => l.qty !== 0);
}

export function buildAnchorChain(rows: Record<string, string>[], cfg: Config): Date[] {
  let anchor = cfg.exportFallback;
  const anchors: Date[] = [];
  for (const row of rows) {
    const t = row.Time ?? "";
    const full = dateFromSlashCell(t, cfg.defaultYear);
    if (full) anchor = full;
    anchors.push(new Date(anchor));
  }
  return anchors;
}


export function equityCurve(trades: CompletedTrade[]): { date: string; cum: number }[] {
  const byDay = new Map<string, number>();
  for (const t of trades) {
    const d = t.closeTs;
    const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    byDay.set(key, (byDay.get(key) ?? 0) + t.plNet);
  }
  const keys = [...byDay.keys()].sort();
  let cum = 0;
  return keys.map((date) => {
    cum += byDay.get(date) ?? 0;
    return { date, cum };
  });
}

export function plByStrategy(trades: CompletedTrade[]): { name: string; pl: number }[] {
  const m = new Map<string, number>();
  for (const t of trades) m.set(t.strategy, (m.get(t.strategy) ?? 0) + t.plNet);
  return [...m.entries()]
    .map(([name, pl]) => ({ name, pl }))
    .sort((a, b) => Math.abs(b.pl) - Math.abs(a.pl));
}

const DTE_ORDER: CompletedTrade["dteChartBucket"][] = ["0", "1–2", "3–5", "6–7", "8+"];

export function plByDteBucket(trades: CompletedTrade[]): { bucket: string; pl: number }[] {
  const m = new Map<string, number>();
  for (const t of trades) m.set(t.dteChartBucket, (m.get(t.dteChartBucket) ?? 0) + t.plNet);
  return DTE_ORDER.map((bucket) => ({ bucket, pl: m.get(bucket) ?? 0 }));
}

export type DashboardStats = {
  totalPl: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  totalTrades: number;
  wins: number;
  losses: number;
};

export function computeDashboard(trades: CompletedTrade[]): DashboardStats {
  const wins = trades.filter((t) => t.win);
  const losses = trades.filter((t) => !t.win);
  const totalPl = trades.reduce((s, t) => s + t.plNet, 0);
  const winRate = trades.length ? wins.length / trades.length : 0;
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.plNet, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + t.plNet, 0) / losses.length : 0;
  return {
    totalPl,
    winRate,
    avgWin,
    avgLoss,
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
  };
}

/** Calendar chip text: `call`, `put`, or `call · put` (iron condor). */
export function tradeRightsLabel(t: CompletedTrade): string {
  const sl = t.strategy.toLowerCase();
  const lbl = t.strikesLabel;
  if (sl.includes("iron condor")) return "call · put";
  if (lbl.includes(" C · ") && lbl.includes(" P")) return "call · put";
  if (sl.includes("bull put") || sl.includes("put debit") || sl.includes("put spread")) return "put";
  if (sl.includes("bear call") || sl.includes("call debit") || sl.includes("call spread")) return "call";
  if (sl.startsWith("put ")) return "put";
  if (sl.startsWith("call ")) return "call";
  if (sl.includes("put credit")) return "put";
  if (sl.includes("call credit")) return "call";
  const putWord = /\bput\b/i.test(t.strategy);
  const callWord = /\bcall\b/i.test(t.strategy);
  if (putWord && callWord) return "call · put";
  if (putWord) return "put";
  if (callWord) return "call";
  return "—";
}
