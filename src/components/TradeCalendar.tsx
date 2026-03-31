"use client";

import { useEffect, useMemo, useState } from "react";
import { tradeRightsLabel, type CompletedTrade } from "@/lib/engine";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function startMondayGrid(year: number, month: number): Date {
  const first = new Date(year, month, 1);
  const dow = first.getDay();
  const mondayOffset = dow === 0 ? 6 : dow - 1;
  return new Date(year, month, 1 - mondayOffset);
}

type TradeCalendarProps = {
  trades: CompletedTrade[];
  fmtUSD: (n: number, digits?: number) => string;
};

function dayTitleLines(dayTrades: CompletedTrade[], fmtUSD: (n: number, d?: number) => string): string {
  const net = dayTrades.reduce((s, t) => s + t.plNet, 0);
  const gross = dayTrades.reduce((s, t) => s + t.plGross, 0);
  const fees = dayTrades.reduce((s, t) => s + t.totalFees, 0);
  const header = `Day net ${fmtUSD(net)} · gross ${fmtUSD(gross)} · fees ${fmtUSD(fees)} · ${dayTrades.length} trade${dayTrades.length === 1 ? "" : "s"}`;
  const lines = dayTrades.map((t) => {
    const side = tradeRightsLabel(t);
    return `${t.symbol} · ${t.strategy} · ${side} · net ${fmtUSD(t.plNet)} gross ${fmtUSD(t.plGross)} fees ${fmtUSD(t.totalFees)} · ${t.strikesLabel}`;
  });
  return [header, ...lines].join("\n");
}

export function TradeCalendar({ trades, fmtUSD }: TradeCalendarProps) {
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [syncedFromData, setSyncedFromData] = useState(false);

  useEffect(() => {
    if (trades.length === 0) {
      setSyncedFromData(false);
      return;
    }
    if (syncedFromData) return;
    let latest = trades[0]!.closeTs;
    for (const t of trades) {
      if (t.closeTs > latest) latest = t.closeTs;
    }
    setCursor(new Date(latest.getFullYear(), latest.getMonth(), 1));
    setSyncedFromData(true);
  }, [trades, syncedFromData]);

  const byDay = useMemo(() => {
    const m = new Map<string, CompletedTrade[]>();
    for (const t of trades) {
      const k = dayKey(t.closeTs);
      const arr = m.get(k) ?? [];
      arr.push(t);
      m.set(k, arr);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => b.closeTs.getTime() - a.closeTs.getTime());
    }
    return m;
  }, [trades]);

  const y = cursor.getFullYear();
  const mo = cursor.getMonth();
  const gridStart = useMemo(() => startMondayGrid(y, mo), [y, mo]);
  const cells = useMemo(() => {
    const out: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      out.push(d);
    }
    return out;
  }, [gridStart]);

  const go = (deltaMonth: number) => {
    setCursor(new Date(y, mo + deltaMonth, 1));
  };

  const monthTitle = cursor.toLocaleString(undefined, { month: "long", year: "numeric" });

  return (
    <section className="mb-8 overflow-visible rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-sm">
      <div className="flex flex-col gap-3 border-b border-[var(--border)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-semibold text-[var(--foreground)]">Calendar</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => go(-1)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--muted-bg)] text-sm text-[var(--foreground)] transition hover:bg-[var(--border)]"
            aria-label="Previous month"
          >
            ←
          </button>
          <span className="min-w-[10rem] text-center font-mono text-sm font-medium text-[var(--foreground)] capitalize">
            {monthTitle}
          </span>
          <button
            type="button"
            onClick={() => go(1)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--muted-bg)] text-sm text-[var(--foreground)] transition hover:bg-[var(--border)]"
            aria-label="Next month"
          >
            →
          </button>
        </div>
      </div>
      <div className="overflow-visible p-3">
        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="py-2 text-center font-mono text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]"
            >
              {d}
            </div>
          ))}
          {cells.map((date) => {
            const inMonth = date.getMonth() === mo;
            const k = dayKey(date);
            const dayTrades = byDay.get(k) ?? [];
            const net = dayTrades.reduce((s, t) => s + t.plNet, 0);
            const dayGross = dayTrades.reduce((s, t) => s + t.plGross, 0);
            const dayFees = dayTrades.reduce((s, t) => s + t.totalFees, 0);
            const hasTrades = dayTrades.length > 0;
            const winDay = net >= 0;
            const nativeTip = hasTrades ? dayTitleLines(dayTrades, fmtUSD) : undefined;
            const ariaLabel = hasTrades ? (nativeTip ?? "") : date.toDateString();

            return (
              <div
                key={`${k}-${mo}`}
                title={nativeTip}
                aria-label={ariaLabel}
                className={`group relative flex min-h-[92px] flex-col rounded-md border border-[var(--border)] p-1 ${
                  inMonth ? "bg-[var(--background)]" : "bg-[var(--muted-bg)]/35 opacity-55"
                } ${hasTrades ? "cursor-default" : ""}`}
              >
                <div className="flex items-start justify-between gap-1">
                  <span className="font-mono text-[11px] font-semibold text-[var(--foreground)]">
                    {date.getDate()}
                  </span>
                </div>
                {hasTrades ? (
                  <>
                    <div
                      className={`mt-1 flex flex-1 flex-col items-center justify-center rounded-md px-1 py-2 text-center transition ${
                        winDay
                          ? "bg-[var(--profit)]/20 ring-1 ring-[var(--profit)]/35"
                          : "bg-[var(--loss)]/20 ring-1 ring-[var(--loss)]/35"
                      }`}
                    >
                      <span
                        className={`font-mono text-sm font-bold tabular-nums ${
                          winDay ? "text-[var(--profit)]" : "text-[var(--loss)]"
                        }`}
                      >
                        {fmtUSD(net, 0)}
                      </span>
                      <span
                        className={`mt-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide ${
                          winDay ? "text-[var(--profit)]" : "text-[var(--loss)]"
                        }`}
                      >
                        {winDay ? "Profit" : "Loss"}
                      </span>
                      <span className="mt-0.5 text-center font-mono text-[9px] leading-tight text-[var(--muted)]">
                        {dayTrades.length}
                      </span>
                    </div>
                    <div
                      className="pointer-events-none invisible absolute left-1/2 top-[calc(100%-4px)] z-50 w-[min(100vw-2rem,260px)] -translate-x-1/2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-left opacity-0 shadow-lg transition duration-150 group-hover:visible group-hover:pointer-events-auto group-hover:opacity-100"
                      role="tooltip"
                    >
                      <div className="border-b border-[var(--border)] pb-2 font-mono text-[11px] text-[var(--foreground)]">
                        <p className="font-semibold">
                          {date.toLocaleDateString()} · net {fmtUSD(net, 0)}{" "}
                          <span className={winDay ? "text-[var(--profit)]" : "text-[var(--loss)]"}>
                            ({winDay ? "profit" : "loss"})
                          </span>
                        </p>
                        <p className="mt-1 text-[10px] text-[var(--muted)]">
                          gross {fmtUSD(dayGross, 0)} · fees {fmtUSD(dayFees, 0)}
                        </p>
                      </div>
                      <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto">
                        {dayTrades.map((t) => (
                          <li key={t.id} className="text-[11px] leading-snug text-[var(--foreground)]">
                            <span className="font-mono font-semibold">{t.symbol}</span>{" "}
                            <span className="text-[var(--muted)]">{tradeRightsLabel(t)}</span>
                            <br />
                            <span className="text-[var(--muted)]">{t.strategy}</span>
                            <br />
                            <span className={t.plNet >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]"}>
                              net {fmtUSD(t.plNet)}
                            </span>
                            <span className="text-[var(--muted)]">
                              {" "}
                              · gross {fmtUSD(t.plGross)} · fees {fmtUSD(t.totalFees)} · {t.strikesLabel}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
