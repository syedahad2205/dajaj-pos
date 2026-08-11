"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { requireFinanceAccess } from "@/lib/roleGuard";
import { firebaseAuthedFetch } from "@/lib/firebaseAuthFetch";
import { formatCurrency, formatDateDisplay, todayDateKey } from "@/lib/financeFormat";
import type { CashDepositType, DailyClosingDepositEntry, DailyClosingExpenseEntry } from "@/lib/finance";
import NativeDateField from "@/components/ui/NativeDateField";

interface ClosingRecord {
  id: string;
  date: string;
  openingCash: number;
  openingCashSource: "chained" | "manual";
  expenses: DailyClosingExpenseEntry[];
  cashExpenseTotal: number;
  deposits: DailyClosingDepositEntry[];
  depositTotal: number;
  totalCashOut: number;
  upiSales: number;
  zomatoSales: number;
  swiggySales: number;
  otherIncome: number;
  closingCash: number | null;
  cashRevenue: number;
  totalRevenue: number;
  locked: boolean;
  closingTime: string | null;
  closedByName: string | null;
  reopenCount: number;
  reopenedByName?: string | null;
  reopenReason?: string | null;
  postingWarnings: string[];
  needsBackfill: boolean;
}

async function readJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) throw new Error(payload?.message || "Request failed.");
  return payload;
}

function firstDayOfThisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function nDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DEPOSIT_TYPE_LABELS: Record<CashDepositType, string> = {
  pigmi: "Pigmi",
  bank: "Bank",
  petty_cash: "Petty Cash",
  owner_withdrawal: "Owner Withdrawal",
  safe: "Returned to Safe",
};

function StatRow({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" | "muted" }) {
  const cls = tone === "positive" ? "text-emerald-600" : tone === "negative" ? "text-rose-600" : tone === "muted" ? "text-slate-400" : "text-slate-800";
  return (
    <div className="flex items-center justify-between border-b border-slate-50 py-1.5 text-sm last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className={`font-semibold ${cls}`}>{value}</span>
    </div>
  );
}

function ClosingCard({ record }: { record: ClosingRecord }) {
  const [expanded, setExpanded] = useState(false);
  const dayPnl = record.totalRevenue - record.cashExpenseTotal;

  return (
    <li className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <button type="button" onClick={() => setExpanded((v) => !v)} className="flex w-full items-center justify-between gap-3 text-left">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-black text-slate-900">{formatDateDisplay(record.date)}</p>
            {record.locked ? (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-600">Closed</span>
            ) : (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-600">Draft</span>
            )}
            {record.reopenCount > 0 ? (
              <span className="rounded-full bg-orange-50 px-2 py-0.5 text-xs font-semibold text-orange-600">
                Reopened {record.reopenCount}×
              </span>
            ) : null}
            {record.needsBackfill ? (
              <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-600">Posting incomplete</span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-400">
            {record.locked && record.closedByName ? `Closed by ${record.closedByName}${record.closingTime ? ` at ${record.closingTime}` : ""}` : "Not yet closed"}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Total Revenue</p>
            <p className="text-base font-black text-slate-900">{formatCurrency(record.totalRevenue)}</p>
          </div>
          <ChevronDown size={18} className={`flex-shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </div>
      </button>

      {expanded ? (
        <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Cash</p>
              <StatRow label="Opening Cash" value={`${formatCurrency(record.openingCash)} (${record.openingCashSource})`} />
              <StatRow label="Closing Cash" value={record.closingCash !== null ? formatCurrency(record.closingCash) : "—"} />
              <StatRow label="Cash Revenue" value={formatCurrency(record.cashRevenue)} tone="positive" />
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Other Revenue</p>
              <StatRow label="UPI" value={formatCurrency(record.upiSales)} />
              <StatRow label="Zomato" value={formatCurrency(record.zomatoSales)} />
              <StatRow label="Swiggy" value={formatCurrency(record.swiggySales)} />
              <StatRow label="Other Income" value={formatCurrency(record.otherIncome)} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Cash Expenses ({record.expenses.length})</p>
              {record.expenses.length === 0 ? (
                <p className="text-sm text-slate-400">None recorded.</p>
              ) : (
                <ul className="space-y-1">
                  {record.expenses.map((e) => (
                    <li key={e.id} className="flex items-center justify-between text-sm">
                      <span className="truncate text-slate-600">
                        {e.categoryName}
                        {e.subcategoryName ? <span className="text-slate-400"> · {e.subcategoryName}</span> : null}
                      </span>
                      <span className="flex-shrink-0 font-semibold text-rose-600">{formatCurrency(e.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <StatRow label="Total" value={formatCurrency(record.cashExpenseTotal)} tone="negative" />
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Cash Deposits ({record.deposits.length})</p>
              {record.deposits.length === 0 ? (
                <p className="text-sm text-slate-400">None recorded.</p>
              ) : (
                <ul className="space-y-1">
                  {record.deposits.map((d) => (
                    <li key={d.id} className="flex items-center justify-between text-sm">
                      <span className="truncate text-slate-600">{d.typeLabel || DEPOSIT_TYPE_LABELS[d.type]}</span>
                      <span className="flex-shrink-0 font-semibold text-sky-600">{formatCurrency(d.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <StatRow label="Total" value={formatCurrency(record.depositTotal)} tone="muted" />
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <StatRow label="Day P&L (Revenue − Cash Expenses)" value={record.locked ? formatCurrency(dayPnl) : "— (not closed)"} tone={record.locked ? (dayPnl >= 0 ? "positive" : "negative") : "muted"} />
          </div>

          {record.reopenCount > 0 ? (
            <p className="text-xs text-slate-500">
              Last reopened by <span className="font-semibold text-slate-700">{record.reopenedByName ?? "—"}</span>
              {record.reopenReason ? <> — &ldquo;{record.reopenReason}&rdquo;</> : null}
            </p>
          ) : null}

          {record.postingWarnings.length > 0 ? (
            <div className="rounded-xl bg-amber-50 px-3 py-2">
              <p className="mb-1 text-xs font-semibold text-amber-700">Posting warnings</p>
              {record.postingWarnings.map((w, i) => (
                <p key={i} className="text-xs text-amber-700">
                  {w}
                </p>
              ))}
            </div>
          ) : null}

          <Link
            href={`/admin/finance/closing?date=${record.date}`}
            className="inline-block rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Open this day →
          </Link>
        </div>
      ) : null}
    </li>
  );
}

function FinanceClosingHistoryContent() {
  const { authenticated, loading, role } = requireFinanceAccess();
  const hasFinanceAccess = authenticated && (role === "admin" || role === "financeManager");

  const [dateFrom, setDateFrom] = useState(firstDayOfThisMonth());
  const [dateTo, setDateTo] = useState(todayDateKey());
  const [records, setRecords] = useState<ClosingRecord[] | null>(null);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState("");

  const presets = [
    { label: "This Month", from: firstDayOfThisMonth(), to: todayDateKey() },
    { label: "Last 7 Days", from: nDaysAgo(6), to: todayDateKey() },
    { label: "Last 30 Days", from: nDaysAgo(29), to: todayDateKey() },
    { label: "Last 90 Days", from: nDaysAgo(89), to: todayDateKey() },
  ];

  const load = async (from: string, to: string) => {
    setFetching(true);
    setError("");
    try {
      const response = await firebaseAuthedFetch(`/api/finance/closing?dateFrom=${from}&dateTo=${to}`);
      const payload = await readJson(response);
      const sorted = [...(payload.closings as ClosingRecord[])].sort((a, b) => (a.date < b.date ? 1 : -1));
      setRecords(sorted);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Daily Closing history.");
    } finally {
      setFetching(false);
    }
  };

  if (loading) {
    return <main className="min-h-screen bg-[#fff8ed] px-4 py-10 text-slate-900">Checking your session…</main>;
  }
  if (!hasFinanceAccess) return null;

  const totals = records?.reduce(
    (acc, r) => ({
      revenue: acc.revenue + r.totalRevenue,
      expenses: acc.expenses + r.cashExpenseTotal,
      closed: acc.closed + (r.locked ? 1 : 0),
    }),
    { revenue: 0, expenses: 0, closed: 0 },
  );

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-3xl space-y-5">
        <header className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <Link href="/admin/finance/closing" aria-label="Back to Daily Closing" className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.28em] text-orange-600">Finance</p>
              <h1 className="text-2xl font-black sm:text-3xl">Daily Closing History</h1>
            </div>
          </div>
          <p className="mt-3 text-sm text-slate-600">
            Every day&apos;s full closing record — opening/closing cash, every expense and deposit line, who closed it, and any reopen or posting
            issues.
          </p>
        </header>

        <div className="space-y-4 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p.label}
                onClick={() => {
                  setDateFrom(p.from);
                  setDateTo(p.to);
                  void load(p.from, p.to);
                }}
                className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                  dateFrom === p.from && dateTo === p.to ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">From</label>
              <NativeDateField value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">To</label>
              <NativeDateField value={dateTo} max={todayDateKey()} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <button
              onClick={() => void load(dateFrom, dateTo)}
              disabled={fetching}
              className="rounded-xl bg-slate-900 px-6 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {fetching ? "Loading…" : "Show History"}
            </button>
          </div>
        </div>

        {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p> : null}

        {records === null && !fetching ? (
          <div className="rounded-[28px] border border-dashed border-slate-300 bg-white p-14 text-center">
            <p className="text-sm font-semibold text-slate-400">Pick a range above and tap &ldquo;Show History&rdquo;</p>
          </div>
        ) : null}

        {fetching ? (
          <div className="rounded-[28px] border border-slate-200 bg-white p-14 text-center">
            <p className="text-sm text-slate-500">Loading…</p>
          </div>
        ) : null}

        {records !== null && !fetching ? (
          records.length === 0 ? (
            <p className="rounded-[28px] border border-slate-200 bg-white p-10 text-center text-sm font-semibold text-slate-400">
              No Daily Closing records in this range.
            </p>
          ) : (
            <>
              {totals ? (
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-2xl border border-slate-200 bg-white p-3 text-center">
                    <p className="text-xs font-semibold uppercase text-slate-400">Days Closed</p>
                    <p className="text-lg font-black text-slate-900">
                      {totals.closed}/{records.length}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-3 text-center">
                    <p className="text-xs font-semibold uppercase text-slate-400">Total Revenue</p>
                    <p className="text-lg font-black text-emerald-600">{formatCurrency(totals.revenue)}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-3 text-center">
                    <p className="text-xs font-semibold uppercase text-slate-400">Total Expenses</p>
                    <p className="text-lg font-black text-rose-600">{formatCurrency(totals.expenses)}</p>
                  </div>
                </div>
              ) : null}
              <ul className="space-y-3">
                {records.map((r) => (
                  <ClosingCard key={r.id} record={r} />
                ))}
              </ul>
            </>
          )
        ) : null}
      </div>
    </main>
  );
}

export default function FinanceClosingHistoryPage() {
  return (
    <Suspense>
      <FinanceClosingHistoryContent />
    </Suspense>
  );
}
