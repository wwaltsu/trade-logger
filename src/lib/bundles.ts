import { detectCsvKind } from "./csvFormat";
import {
  type CompletedTrade,
  type Config,
  type Leg,
  buildAnchorChain,
  dedupeLegsForSpread,
  dteChartBucket,
  dteOnDate,
  eventContracts,
  fifoKey,
  formatPremiumSigned,
  isCloseEvent,
  isOpenEvent,
  legExpiryDate,
  maxRiskForOpen,
  parseExpMdYToLegMonthDay,
  parseLegsFromDescription,
  parsePremium,
  parseTime,
  refineStrategy,
  strikesLabel,
} from "./engine";

/** One logical execution: all legs sharing the same Order # (partial fills included). */
export type OrderBundle = {
  orderId: string;
  symbol: string;
  ts: Date;
  legs: Leg[];
  contracts: number;
  /** Sum of Value (premium cash, USD). STO/STO-style signs already in broker data. */
  sumValue: number;
  /** Sum of Total (cash after commissions + fees per leg). */
  sumTotal: number;
  /** Sum of Commissions + Fees (typically negative). */
  feeImpact: number;
  isOpen: boolean;
  fifoKey: string;
  strategy: string;
  dteAtEvent: number;
  dteChartBucket: CompletedTrade["dteChartBucket"];
  source: "transaction" | "activity";
};

export function normalizeOrderId(raw: string): string {
  return raw.replace(/^#/, "").trim();
}

function parseTxnNum(s: string): number {
  const n = parseFloat(String(s).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function groupRowsByOrderId(rows: Record<string, string>[]): Map<string, Record<string, string>[]> {
  const m = new Map<string, Record<string, string>[]>();
  for (const r of rows) {
    const oid = normalizeOrderId(r["Order #"] ?? r["Order"] ?? "");
    if (!oid) continue;
    const arr = m.get(oid) ?? [];
    arr.push(r);
    m.set(oid, arr);
  }
  return m;
}

function subTypeToAction(sub: string): Leg["action"] | null {
  const s = sub.toLowerCase();
  if (s.includes("sell to open")) return "STO";
  if (s.includes("buy to open")) return "BTO";
  if (s.includes("sell to close")) return "STC";
  if (s.includes("buy to close")) return "BTC";
  return null;
}

function transactionRowToLeg(row: Record<string, string>, cfg: Config): Leg | null {
  const sub = (row["Sub Type"] ?? "").trim();
  const action = subTypeToAction(sub);
  if (!action) return null;
  const expRaw = (row["Expiration Date"] ?? "").trim();
  const strike = parseTxnNum(row["Strike Price"] ?? "0");
  const cp = (row["Call or Put"] ?? "").toUpperCase();
  const right: Leg["right"] = cp === "PUT" ? "Put" : "Call";
  const qty = Math.round(Math.abs(parseTxnNum(row["Quantity"] ?? "1"))) || 1;
  const md = parseExpMdYToLegMonthDay(expRaw, cfg.defaultYear);
  if (!md) return null;
  return {
    qty,
    month: md.month,
    day: md.day,
    dteToken: "Exp",
    strike,
    right,
    action,
  };
}

function transactionGroupToBundle(
  orderId: string,
  group: Record<string, string>[],
  cfg: Config,
): OrderBundle | null {
  const legs: Leg[] = [];
  let sumValue = 0;
  let sumTotal = 0;
  let feeImpact = 0;
  let maxTs = new Date(0);

  const symbol = (group[0]?.["Underlying Symbol"] ?? group[0]?.["Root Symbol"] ?? "").trim();
  if (!symbol) return null;

  for (const r of group) {
    const leg = transactionRowToLeg(r, cfg);
    if (leg) legs.push(leg);
    sumValue += parseTxnNum(r.Value ?? "0");
    sumTotal += parseTxnNum(r.Total ?? "0");
    feeImpact += parseTxnNum(r.Commissions ?? "0") + parseTxnNum(r.Fees ?? "0");
    const d = new Date(r.Date ?? "");
    if (!Number.isNaN(d.getTime()) && d.getTime() > maxTs.getTime()) maxTs = d;
  }

  const merged = dedupeLegsForSpread(legs);
  if (merged.length === 0 || Number.isNaN(maxTs.getTime())) return null;

  const contracts = eventContracts(merged);
  const open = isOpenEvent(merged);
  const close = isCloseEvent(merged);
  if ((open && close) || (!open && !close)) return null;
  const bundleOpen = open && !close;

  const signedPerShare = sumValue / (100 * Math.max(1, contracts));
  const fifo = fifoKey(symbol, merged, cfg);
  const ex0 = merged[0]!;
  const dte = dteOnDate(legExpiryDate(ex0, cfg.defaultYear), maxTs);
  const strategy = bundleOpen ? refineStrategy(merged, signedPerShare) : "Close";

  return {
    orderId,
    symbol,
    ts: maxTs,
    legs: merged,
    contracts,
    sumValue,
    sumTotal,
    feeImpact,
    isOpen: bundleOpen,
    fifoKey: fifo,
    strategy,
    dteAtEvent: dte,
    dteChartBucket: dteChartBucket(dte),
    source: "transaction",
  };
}

export function buildTransactionBundles(rows: Record<string, string>[], cfg: Config): OrderBundle[] {
  const trades = rows.filter((r) => (r.Type ?? "").trim().toLowerCase() === "trade");
  const options = trades.filter((r) => (r["Instrument Type"] ?? "").toLowerCase().includes("option"));
  const groups = groupRowsByOrderId(options);
  const out: OrderBundle[] = [];
  for (const [oid, g] of groups) {
    const b = transactionGroupToBundle(oid, g, cfg);
    if (b) out.push(b);
  }
  return out;
}

type IndexedRow = { row: Record<string, string>; idx: number };

function activityGroupToBundle(
  orderId: string,
  group: IndexedRow[],
  anchors: Date[],
  cfg: Config,
): OrderBundle | null {
  const legs = dedupeLegsForSpread(
    group.flatMap(({ row }) => parseLegsFromDescription(row.Description ?? "")),
  );
  if (legs.length === 0) return null;
  const symbol = (group[0]!.row.Symbol ?? "").trim();
  if (!symbol) return null;
  const signedPremiumPerShare = group.reduce(
    (s, { row }) => s + parsePremium(row.MarketOrFill ?? row["MarketOrFill"] ?? ""),
    0,
  );
  const contracts = eventContracts(legs);
  const sumValue = signedPremiumPerShare * 100 * contracts;
  const open = isOpenEvent(legs);
  const close = isCloseEvent(legs);
  if ((open && close) || (!open && !close)) return null;
  const bundleOpen = open && !close;
  const ts = new Date(
    Math.max(
      ...group.map(({ row, idx }) =>
        parseTime(row.Time ?? "", anchors[idx]!, cfg.defaultYear).getTime(),
      ),
    ),
  );
  const fifo = fifoKey(symbol, legs, cfg);
  const signedPerShare = signedPremiumPerShare;
  const ex0 = legs[0]!;
  const dte = dteOnDate(legExpiryDate(ex0, cfg.defaultYear), ts);
  const strategy = bundleOpen ? refineStrategy(legs, signedPerShare) : "Close";

  return {
    orderId,
    symbol,
    ts,
    legs,
    contracts,
    sumValue,
    sumTotal: sumValue,
    feeImpact: 0,
    isOpen: bundleOpen,
    fifoKey: fifo,
    strategy,
    dteAtEvent: dte,
    dteChartBucket: dteChartBucket(dte),
    source: "activity",
  };
}

export function buildActivityBundles(rows: Record<string, string>[], cfg: Config): OrderBundle[] {
  const anchors = buildAnchorChain(rows, cfg);
  const indexed: IndexedRow[] = rows.map((row, idx) => ({ row, idx }));
  const filled = indexed.filter(({ row }) => {
    const st = (row.Status ?? "").trim().toLowerCase();
    return !st || st === "filled";
  });
  const byOrder = new Map<string, IndexedRow[]>();
  for (const x of filled) {
    const oid = normalizeOrderId(x.row["Order #"] ?? x.row["Order"] ?? "");
    if (!oid) continue;
    const arr = byOrder.get(oid) ?? [];
    arr.push(x);
    byOrder.set(oid, arr);
  }
  const out: OrderBundle[] = [];
  for (const [oid, g] of byOrder) {
    const b = activityGroupToBundle(oid, g, anchors, cfg);
    if (b) out.push(b);
  }
  return out;
}

export function fifoMatchBundles(bundles: OrderBundle[], cfg: Config): CompletedTrade[] {
  const sorted = [...bundles].sort((a, b) => a.ts.getTime() - b.ts.getTime());
  const opens = new Map<string, OrderBundle[]>();
  const trades: CompletedTrade[] = [];
  let seq = 0;
  for (const b of sorted) {
    if (b.isOpen) {
      const q = opens.get(b.fifoKey) ?? [];
      q.push(b);
      opens.set(b.fifoKey, q);
      continue;
    }
    const q = opens.get(b.fifoKey);
    if (!q?.length) continue;
    const op = q.shift()!;
    if (!q.length) opens.delete(b.fifoKey);
    else opens.set(b.fifoKey, q);

    const contracts = Math.min(op.contracts, b.contracts);
    const scaleOpen = contracts / op.contracts;
    const scaleClose = contracts / b.contracts;
    const openSumValue = op.sumValue * scaleOpen;
    const closeSumValue = b.sumValue * scaleClose;
    const openSumTotal = op.sumTotal * scaleOpen;
    const closeSumTotal = b.sumTotal * scaleClose;
    const openFeeImpact = op.feeImpact * scaleOpen;
    const closeFeeImpact = b.feeImpact * scaleClose;

    const plGross = openSumValue + closeSumValue;
    let plNet: number;
    let totalFees: number;
    if (op.source === "transaction" && b.source === "transaction") {
      plNet = openSumTotal + closeSumTotal;
      totalFees = -(openFeeImpact + closeFeeImpact);
    } else {
      totalFees = cfg.feePerContractRT * contracts;
      plNet = plGross - totalFees;
    }

    const entryPerShare = openSumValue / (100 * contracts);
    const exitPerShare = closeSumValue / (100 * contracts);
    const openSignedForRisk = openSumValue / (100 * contracts);
    const openTs = op.ts.getTime() <= b.ts.getTime() ? op.ts : b.ts;
    const closeTs = op.ts.getTime() <= b.ts.getTime() ? b.ts : op.ts;
    const strategy = refineStrategy(op.legs, op.sumValue / (100 * Math.max(1, op.contracts)));
    const maxRisk = maxRiskForOpen(op.legs, openSignedForRisk, contracts);
    const returnOnRiskPct = maxRisk > 0 ? (plNet / maxRisk) * 100 : 0;
    seq += 1;
    trades.push({
      id: `t-${seq}`,
      symbol: b.symbol,
      strategy,
      openTs,
      closeTs,
      dteAtOpen: op.dteAtEvent,
      dteChartBucket: op.dteChartBucket,
      strikesLabel: strikesLabel(op.legs),
      contracts,
      entryPerShare,
      exitPerShare,
      entryCreditDisplay: formatPremiumSigned(entryPerShare),
      exitDisplay: formatPremiumSigned(exitPerShare),
      plGross,
      totalFees,
      plNet,
      maxRisk,
      returnOnRiskPct,
      win: plNet >= 0,
    });
  }
  return trades;
}

export function buildCompletedTrades(rows: Record<string, string>[], cfg: Config): CompletedTrade[] {
  if (rows.length === 0) return [];
  const kind = detectCsvKind(rows[0]!);
  const bundles =
    kind === "transaction_history" ? buildTransactionBundles(rows, cfg) : buildActivityBundles(rows, cfg);
  bundles.sort((a, b) => a.ts.getTime() - b.ts.getTime());
  return fifoMatchBundles(bundles, cfg);
}
