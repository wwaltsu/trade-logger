"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Area,
  AreaChart,
} from "recharts";
import { parseTastyCsv, dedupeCsvRows } from "@/lib/csv";
import { buildCompletedTrades } from "@/lib/bundles";
import {
  computeDashboard,
  equityCurve,
  plByDteBucket,
  plByStrategy,
  type CompletedTrade,
  type Config,
} from "@/lib/engine";
import { ThemeToggle } from "./ThemeToggle";
import { TradeCalendar } from "./TradeCalendar";
import { clearJournalStorage, loadJournal, saveJournal, storedTradesToCompleted } from "@/lib/storage";

const DEFAULT_CFG: Config = {
  defaultYear: 2026,
  exportFallback: new Date(2026, 2, 30, 12, 0, 0),
  feePerContractRT: 1,
};

/** Fictitious transaction history for screenshots / demos. */
const DEMO_TRANSACTION_CSV_URL = "/samples/demo-transaction-history.csv";
/** Shown when Load demo runs; `isDemoSession` matches the stable suffix. */
const DEMO_SESSION_FILE_LABEL = "demo-transaction-history.csv · demo data";

function isDemoSession(fileName: string | null): boolean {
  return Boolean(fileName?.endsWith("· demo data"));
}

function fmtUSD(n: number, digits = 0): string {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function fmtPct(n: number): string {
  return `${n >= 0 ? "" : "−"}${Math.abs(n).toFixed(1)}%`;
}

const CHART_COLORS = {
  profit: "var(--chart-profit)",
  loss: "var(--chart-loss)",
  grid: "var(--chart-grid)",
  axis: "var(--chart-axis)",
};

/** Shared header control sizing (hover/focus/active). */
const headerBtn =
  "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-[var(--card)] px-4 py-2.5 text-base font-medium text-[var(--foreground)] shadow-sm transition hover:bg-[var(--muted-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--foreground)]/25 active:bg-[var(--muted-bg)]";

export function JournalApp() {
  const [trades, setTrades] = useState<CompletedTrade[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [strategyFilter, setStrategyFilter] = useState<string>("");
  const [tickerFilter, setTickerFilter] = useState<string>("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = loadJournal();
    if (stored && stored.trades.length > 0) {
      setFileName(stored.fileName);
      setTrades(storedTradesToCompleted(stored.trades));
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveJournal(fileName, trades);
  }, [fileName, trades, hydrated]);

  const onFile = useCallback(async (f: File | null) => {
    setError(null);
    if (!f) return;
    setFileName(f.name);
    try {
      const text = await f.text();
      let rows = parseTastyCsv(text);
      rows = dedupeCsvRows(rows);
      const built = buildCompletedTrades(rows, DEFAULT_CFG);
      setTrades(built);
    } catch {
      setError("Could not read file. Use a tastytrade activity CSV export.");
      setTrades([]);
    }
  }, []);

  const loadDemoTransactionSample = useCallback(async () => {
    setError(null);
    setStrategyFilter("");
    setTickerFilter("");
    try {
      const res = await fetch(DEMO_TRANSACTION_CSV_URL);
      if (!res.ok) throw new Error("fetch failed");
      const text = await res.text();
      let rows = parseTastyCsv(text);
      rows = dedupeCsvRows(rows);
      const built = buildCompletedTrades(rows, DEFAULT_CFG);
      setFileName(DEMO_SESSION_FILE_LABEL);
      setTrades(built);
    } catch {
      setError("Could not load demo CSV.");
      setTrades([]);
    }
  }, []);

  const strategies = useMemo(() => {
    const s = new Set(trades.map((t) => t.strategy));
    return [...s].sort();
  }, [trades]);

  const tickers = useMemo(() => {
    const s = new Set(trades.map((t) => t.symbol));
    return [...s].sort();
  }, [trades]);

  const filtered = useMemo(() => {
    return trades.filter((t) => {
      if (strategyFilter && t.strategy !== strategyFilter) return false;
      if (tickerFilter && t.symbol !== tickerFilter) return false;
      return true;
    });
  }, [trades, strategyFilter, tickerFilter]);

  const stats = useMemo(() => computeDashboard(filtered), [filtered]);
  const eq = useMemo(() => equityCurve(filtered), [filtered]);
  const byStrat = useMemo(() => plByStrategy(filtered), [filtered]);
  const byDte = useMemo(() => plByDteBucket(filtered), [filtered]);

  const clearButtonLabel = isDemoSession(fileName) ? "Close demo" : "Clear saved";
  const clearButtonTitle = isDemoSession(fileName)
    ? "Exit demo — nothing is deleted from your disk"
    : "Clear saved journal and filters from this browser";

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-mono text-xl font-semibold tracking-tight text-[var(--foreground)] sm:text-2xl">
          Trade Logger
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <label
            className={`${headerBtn} cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--foreground)]/25`}
          >
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
            />
            Upload CSV
          </label>
          {!isDemoSession(fileName) && (
            <button
              type="button"
              onClick={() => void loadDemoTransactionSample()}
              className={`${headerBtn} border-dashed bg-[var(--muted-bg)]/50 font-semibold`}
              title="Fictitious DEMO ticker — for screenshots without your positions"
            >
              Load demo
            </button>
          )}
          {(trades.length > 0 || fileName) && (
            <button
              type="button"
              onClick={() => {
                clearJournalStorage();
                setTrades([]);
                setFileName(null);
                setStrategyFilter("");
                setTickerFilter("");
              }}
              className={headerBtn}
              title={clearButtonTitle}
            >
              {clearButtonLabel}
            </button>
          )}
          <ThemeToggle />
        </div>
      </header>

      {error ? (
        <p className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      {(fileName || trades.length > 0) && (
        <p className="mb-6 font-mono text-xs text-[var(--muted)]">
          {fileName ? <span className="text-[var(--foreground)]">{fileName}</span> : null}
          {fileName && trades.length > 0 ? " · " : ""}
          {trades.length > 0 ? `${filtered.length}/${trades.length}` : ""}
        </p>
      )}

      {filtered.length === 0 && trades.length > 0 ? (
        <section className="mb-8 rounded-xl border border-[var(--border)] bg-[var(--card)] px-5 py-6 shadow-sm">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">No trades match filters</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">Adjust strategy or ticker, or clear filters to see all trades again.</p>
          <button
            type="button"
            onClick={() => {
              setStrategyFilter("");
              setTickerFilter("");
            }}
            className={`${headerBtn} mt-4 w-full sm:w-auto`}
          >
            Clear filters
          </button>
        </section>
      ) : null}

      {filtered.length > 0 ? (
        <>
          <section className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard
              label="Total P/L"
              value={fmtUSD(stats.totalPl)}
              sub="Net · after modeled fees"
              accent={stats.totalPl >= 0}
            />
            <StatCard
              label="Win rate"
              value={fmtPct(stats.winRate * 100)}
              sub={`${stats.wins}W / ${stats.losses}L`}
              accent={stats.winRate >= 0.5}
            />
            <StatCard label="Avg win" value={fmtUSD(stats.avgWin)} accent />
            <StatCard label="Avg loss" value={fmtUSD(stats.avgLoss)} accent={false} />
            <StatCard label="Trades" value={String(stats.totalTrades)} />
          </section>

          <section className="mb-8 flex flex-wrap gap-3">
            <select
              value={strategyFilter}
              onChange={(e) => setStrategyFilter(e.target.value)}
              className="rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--foreground)]"
            >
              <option value="">All strategies</option>
              {strategies.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={tickerFilter}
              onChange={(e) => setTickerFilter(e.target.value)}
              className="rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--foreground)]"
            >
              <option value="">All tickers</option>
              {tickers.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </section>

          <TradeCalendar key={fileName ?? "none"} trades={filtered} fmtUSD={fmtUSD} />

          <section className="mb-8 grid gap-4 lg:grid-cols-3">
            <ChartCard title="Equity">
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={eq} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-profit)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--chart-profit)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: CHART_COLORS.axis, fontSize: 10 }} />
                  <YAxis
                    tick={{ fill: CHART_COLORS.axis, fontSize: 10 }}
                    tickFormatter={(v) => fmtUSD(v, 0)}
                    width={56}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(v) => [fmtUSD(Number(v)), "P/L"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="cum"
                    stroke="var(--chart-profit)"
                    fill="url(#eqFill)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="By strategy">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={byStrat} layout="vertical" margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fill: CHART_COLORS.axis, fontSize: 10 }} tickFormatter={(v) => fmtUSD(v, 0)} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={100}
                    tick={{ fill: CHART_COLORS.axis, fontSize: 10 }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(v) => [fmtUSD(Number(v)), "P/L"]}
                  />
                  <Bar dataKey="pl" radius={[0, 4, 4, 0]} fill="var(--chart-accent)" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="By DTE">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={byDte} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="bucket" tick={{ fill: CHART_COLORS.axis, fontSize: 10 }} />
                  <YAxis tick={{ fill: CHART_COLORS.axis, fontSize: 10 }} tickFormatter={(v) => fmtUSD(v, 0)} width={52} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(v) => [fmtUSD(Number(v)), "P/L"]}
                  />
                  <Bar dataKey="pl" radius={[4, 4, 0, 0]}>
                    {byDte.map((row) => (
                      <Cell
                        key={row.bucket}
                        fill={row.pl >= 0 ? "var(--chart-profit)" : "var(--chart-loss)"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </section>

          <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-sm">
            <div className="border-b border-[var(--border)] px-4 py-3">
              <h2 className="text-sm font-semibold text-[var(--foreground)]">Trades</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--muted-bg)] font-mono text-[11px] uppercase tracking-wide text-[var(--muted)]">
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Ticker</th>
                    <th className="px-3 py-2 font-medium">Strategy</th>
                    <th className="px-3 py-2 font-medium text-right">DTE</th>
                    <th className="px-3 py-2 font-medium">Strikes</th>
                    <th className="px-3 py-2 font-medium text-right">Credit</th>
                    <th className="px-3 py-2 font-medium text-right" title="Premium P/L before fees">
                      Gross
                    </th>
                    <th className="px-3 py-2 font-medium text-right">Fees</th>
                    <th className="px-3 py-2 font-medium text-right" title="After fees">
                      Net P/L
                    </th>
                    <th className="px-3 py-2 font-medium text-right">Return %</th>
                  </tr>
                </thead>
                <tbody>
                  {[...filtered].reverse().map((t) => (
                    <tr
                      key={t.id}
                      className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted-bg)]/60"
                    >
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-[var(--foreground)]">
                        {t.closeTs.toLocaleDateString()}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs font-semibold text-[var(--foreground)]">
                        {t.symbol}
                      </td>
                      <td className="max-w-[200px] truncate px-3 py-2 text-[var(--foreground)]" title={t.strategy}>
                        {t.strategy}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-[var(--muted)]">{t.dteAtOpen}</td>
                      <td className="px-3 py-2 font-mono text-xs text-[var(--muted)]">{t.strikesLabel}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-[var(--foreground)]">
                        {t.entryCreditDisplay}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-mono text-xs ${t.plGross >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]"
                          }`}
                      >
                        {fmtUSD(t.plGross)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-[var(--muted)]">
                        {fmtUSD(t.totalFees)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-mono text-xs font-semibold ${t.plNet >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]"
                          }`}
                      >
                        {fmtUSD(t.plNet)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-mono text-xs ${t.returnOnRiskPct >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]"
                          }`}
                      >
                        {fmtPct(t.returnOnRiskPct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : trades.length === 0 && hydrated && !error ? (
        <section className="welcome-shell shadow-md">
          <div className="rounded-[calc(1rem-1px)] bg-[var(--card)] px-6 py-10 sm:px-10 sm:py-12">
            <p className="welcome-enter welcome-enter-delay-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
              Welcome to
            </p>
            <h2 className="welcome-enter welcome-enter-delay-1 font-mono text-3xl font-semibold tracking-tight text-[var(--foreground)] sm:text-4xl">
              Trade Logger
            </h2>
            <p className="welcome-enter welcome-enter-delay-2 mt-3 max-w-xl text-base leading-relaxed text-[var(--muted)]">
              Options journal from your tastytrade CSV — open/close matching, calendar, and charts in the browser.
            </p>
            <div className="welcome-enter welcome-enter-delay-2 mt-8 h-px w-16 max-w-full bg-[var(--border)]" aria-hidden />
            <p className="welcome-enter welcome-enter-delay-3 mt-8 max-w-2xl text-base leading-relaxed text-[var(--muted)]">
              Start with <strong className="font-medium text-[var(--foreground)]">Upload CSV</strong>: a{" "}
              <strong className="font-medium text-[var(--foreground)]">transaction history</strong> file is recommended (fees and
              totals included). The classic <strong className="font-medium text-[var(--foreground)]">activity</strong> CSV works
              too. Nothing leaves your machine.
            </p>
            <p className="welcome-enter welcome-enter-delay-3 mt-5 max-w-2xl text-base leading-relaxed text-[var(--muted)]">
              Try <strong className="font-medium text-[var(--foreground)]">Load demo</strong> for fictitious{" "}
              <span className="font-mono text-sm text-[var(--foreground)]">DEMO</span> trades — same charts, no real positions.
            </p>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  const color =
    accent === undefined
      ? "text-[var(--foreground)]"
      : accent
        ? "text-[var(--profit)]"
        : "text-[var(--loss)]";
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-3 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className={`mt-1 font-mono text-lg font-semibold tabular-nums ${color}`}>{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-[var(--muted)]">{sub}</p> : null}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 shadow-sm">
      <p className="mb-2 text-xs font-semibold text-[var(--foreground)]">{title}</p>
      {children}
    </div>
  );
}
