"use client";

import { useState } from "react";
import { requireFinanceAccess } from "@/lib/roleGuard";
import { firebaseAuthedFetch } from "@/lib/firebaseAuthFetch";
import { formatCurrency, formatDateDisplay, todayDateKey } from "@/lib/financeFormat";
import FinanceNav from "@/components/finance/FinanceNav";
import NativeDateField from "@/components/ui/NativeDateField";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DepositEntry {
  id: string;
  type: string;
  typeLabel: string;
  amount: number;
  remarks: string;
}

interface DailyClosingRow {
  date: string;
  cashRevenue: number;
  upiSales: number;
  zomatoSales: number;
  swiggySales: number;
  otherIncome: number;
  totalRevenue: number;
  cashExpenseTotal: number;
  depositTotal: number;
  locked: boolean;
  deposits: DepositEntry[];
}

interface CategoryItem {
  label: string;
  amount: number;
}

interface RevenueBreakdown {
  cashSales: number;
  upi: number;
  zomato: number;
  swiggy: number;
  otherIncome: number;
  ledgerIncome: number;
}

interface ReportSummary {
  closedDays: number;
  draftDays: number;
  totalRevenue: number;
  totalExpense: number;
  netPnl: number;
  revenueBreakdown: RevenueBreakdown;
  expenseByCategory: CategoryItem[];
  ledgerIncomeByCategory: CategoryItem[];
  depositBreakdown: CategoryItem[];
  closingDeposits: number;
}

interface PnlReport {
  closings: DailyClosingRow[];
  summary: ReportSummary;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function firstDayOfThisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function firstDayOfLastMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function lastDayOfLastMonth(): string {
  const d = new Date();
  d.setDate(0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function nDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function readJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) throw new Error(payload?.message || "Request failed.");
  return payload;
}

function pct(part: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "positive" | "negative" | "muted" | "default";
}) {
  const valueClass =
    tone === "positive"
      ? "text-emerald-600"
      : tone === "negative"
        ? "text-rose-600"
        : tone === "muted"
          ? "text-slate-400"
          : "text-slate-900";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-black ${valueClass}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

function BarRow({
  label,
  amount,
  total,
  color,
}: {
  label: string;
  amount: number;
  total: number;
  color: string;
}) {
  const pctNum = total > 0 ? (amount / total) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-36 shrink-0 truncate text-right text-xs font-medium text-slate-600">{label}</div>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(1, pctNum)}%` }} />
      </div>
      <div className="w-24 text-right text-sm font-semibold text-slate-800">{formatCurrency(amount)}</div>
      <div className="w-10 text-right text-xs text-slate-400">{pct(amount, total)}</div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FinanceReportsPage() {
  const { authenticated, loading, role } = requireFinanceAccess();
  const hasFinanceAccess = authenticated && (role === "admin" || role === "financeManager");
  const canQuery = hasFinanceAccess;

  const [dateFrom, setDateFrom] = useState(firstDayOfThisMonth());
  const [dateTo, setDateTo] = useState(todayDateKey());
  const [report, setReport] = useState<PnlReport | null>(null);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState("");

  const presets = [
    { label: "This Month", from: firstDayOfThisMonth(), to: todayDateKey() },
    { label: "Last Month", from: firstDayOfLastMonth(), to: lastDayOfLastMonth() },
    { label: "Last 7 Days", from: nDaysAgo(6), to: todayDateKey() },
    { label: "Last 30 Days", from: nDaysAgo(29), to: todayDateKey() },
    { label: "Last 90 Days", from: nDaysAgo(89), to: todayDateKey() },
  ];

  const generate = async () => {
    if (!canQuery) return;
    setFetching(true);
    setError("");
    try {
      const response = await firebaseAuthedFetch(`/api/finance/reports/pnl?dateFrom=${dateFrom}&dateTo=${dateTo}`);
      const payload = await readJson(response);
      const sortedClosings = [...(payload.closings as DailyClosingRow[])].sort((a, b) =>
        a.date < b.date ? 1 : -1,
      );
      setReport({ closings: sortedClosings, summary: payload.summary as ReportSummary });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate report.");
    } finally {
      setFetching(false);
    }
  };

  if (loading) {
    return <main className="min-h-screen bg-[#fff8ed] px-4 py-10 text-slate-900">Checking your session…</main>;
  }
  if (!hasFinanceAccess) return null;

  const s = report?.summary ?? null;
  const rows = report?.closings ?? [];
  const netPnl = s?.netPnl ?? 0;
  const grossMarginPct = s && s.totalRevenue > 0 ? Math.round(((s.totalRevenue - s.totalExpense) / s.totalRevenue) * 100) : null;
  const rb = s?.revenueBreakdown;

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-6xl space-y-5">
        {/* Header */}
        <header className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-orange-600">Finance · Admin Only</p>
          <h1 className="mt-1 text-3xl font-black">P&amp;L Report</h1>
          <p className="mt-2 text-sm text-slate-600">
            On-demand profit &amp; loss report — combines Daily Closing revenue/expenses with all Transactions ledger entries across any date range.
          </p>
          <div className="mt-5">
            <FinanceNav role={role} />
          </div>
        </header>

        {/* Date Range + Presets + Generate */}
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p.label}
                onClick={() => {
                  setDateFrom(p.from);
                  setDateTo(p.to);
                }}
                className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                  dateFrom === p.from && dateTo === p.to
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
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
              onClick={generate}
              disabled={fetching}
              className="rounded-xl bg-slate-900 px-6 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {fetching ? "Generating…" : "Generate Report"}
            </button>
          </div>
        </div>

        {error && (
          <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p>
        )}

        {/* Empty state */}
        {report === null && !fetching && (
          <div className="rounded-[28px] border border-dashed border-slate-300 bg-white p-14 text-center">
            <p className="text-sm font-semibold text-slate-400">Select a date range above and click &ldquo;Generate Report&rdquo;</p>
            <p className="mt-1 text-xs text-slate-300">Revenue, expenses, P&amp;L, and daily breakdown will appear here</p>
          </div>
        )}

        {fetching && (
          <div className="rounded-[28px] border border-slate-200 bg-white p-14 text-center">
            <p className="text-sm text-slate-500">Generating report…</p>
          </div>
        )}

        {report !== null && !fetching && s && (
          <>
            {/* Draft warning */}
            {s.draftDays > 0 && (
              <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
                ⚠️ {s.draftDays} day{s.draftDays > 1 ? "s" : ""} in this range {s.draftDays > 1 ? "are" : "is"} still Draft (not yet closed) — those Daily Closing
                amounts are excluded from P&amp;L totals. Transactions from those dates are still included.
              </p>
            )}

            {/* ── KPI Summary ── */}
            <section>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Summary — {s.closedDays} closed day{s.closedDays !== 1 ? "s" : ""}
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard label="Total Revenue" value={formatCurrency(s.totalRevenue)} tone="positive" />
                <KpiCard label="Total Expenses" value={formatCurrency(s.totalExpense)} tone="negative" />
                <KpiCard
                  label="Net P&L"
                  value={formatCurrency(netPnl)}
                  tone={netPnl >= 0 ? "positive" : "negative"}
                  sub={netPnl >= 0 ? "Profitable" : "Loss-making"}
                />
                <KpiCard
                  label="Gross Margin"
                  value={grossMarginPct !== null ? `${grossMarginPct}%` : "—"}
                  tone={grossMarginPct !== null ? (grossMarginPct >= 0 ? "positive" : "negative") : "muted"}
                  sub="(Revenue − Expense) ÷ Revenue"
                />
              </div>
            </section>

            {/* ── Revenue + Expense Breakdown ── */}
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Revenue Breakdown */}
              <section className="space-y-3 rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-black text-slate-900">Revenue Breakdown</p>
                  <span className="text-sm font-bold text-emerald-600">{formatCurrency(s.totalRevenue)}</span>
                </div>
                {s.totalRevenue === 0 ? (
                  <p className="text-sm text-slate-400">No revenue recorded.</p>
                ) : (
                  <div className="space-y-2.5">
                    {rb && rb.cashSales > 0 && (
                      <BarRow label="Cash Sales" amount={rb.cashSales} total={s.totalRevenue} color="bg-emerald-400" />
                    )}
                    {rb && rb.upi > 0 && (
                      <BarRow label="UPI" amount={rb.upi} total={s.totalRevenue} color="bg-blue-400" />
                    )}
                    {rb && rb.zomato > 0 && (
                      <BarRow label="Zomato" amount={rb.zomato} total={s.totalRevenue} color="bg-orange-400" />
                    )}
                    {rb && rb.swiggy > 0 && (
                      <BarRow label="Swiggy" amount={rb.swiggy} total={s.totalRevenue} color="bg-amber-400" />
                    )}
                    {rb && rb.otherIncome > 0 && (
                      <BarRow label="Other Income" amount={rb.otherIncome} total={s.totalRevenue} color="bg-purple-400" />
                    )}
                    {rb && rb.ledgerIncome > 0 && (
                      <BarRow label="Ledger Income" amount={rb.ledgerIncome} total={s.totalRevenue} color="bg-indigo-400" />
                    )}
                  </div>
                )}
                {/* Ledger income category detail */}
                {s.ledgerIncomeByCategory.length > 0 && (
                  <div className="mt-3 border-t border-slate-100 pt-3 space-y-1.5">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Ledger income breakdown</p>
                    {s.ledgerIncomeByCategory.map((item) => (
                      <div key={item.label} className="flex items-center justify-between text-xs text-slate-500">
                        <span>{item.label}</span>
                        <span className="font-semibold text-slate-700">{formatCurrency(item.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Expense Breakdown */}
              <section className="space-y-3 rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-black text-slate-900">Expenses by Category</p>
                  <span className="text-sm font-bold text-rose-600">{formatCurrency(s.totalExpense)}</span>
                </div>
                <p className="text-xs text-slate-400">Cash drawer expenses + all ledger expense transactions</p>
                {s.expenseByCategory.length === 0 ? (
                  <p className="text-sm text-slate-400">No expenses recorded.</p>
                ) : (
                  <div className="space-y-2.5">
                    {s.expenseByCategory.map((cat) => (
                      <BarRow key={cat.label} label={cat.label} amount={cat.amount} total={s.totalExpense} color="bg-rose-400" />
                    ))}
                  </div>
                )}
              </section>
            </div>

            {/* ── Deposits Summary ── */}
            {s.depositBreakdown.length > 0 && (
              <section className="space-y-3 rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-black text-slate-900">Cash Deposits (moved out of drawer)</p>
                  <span className="text-sm font-bold text-sky-600">{formatCurrency(s.closingDeposits)}</span>
                </div>
                <div className="space-y-2.5">
                  {s.depositBreakdown.map((d) => (
                    <BarRow key={d.label} label={d.label} amount={d.amount} total={s.closingDeposits} color="bg-sky-400" />
                  ))}
                </div>
                <p className="text-xs text-slate-400">
                  Deposits don&apos;t affect P&amp;L — they move cash from the drawer to another account (e.g. bank or Pigmi).
                </p>
              </section>
            )}

            {/* ── Day-by-Day Table ── */}
            <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <p className="text-sm font-black text-slate-900">Daily Breakdown</p>
                <p className="text-xs text-slate-400">{rows.length} day{rows.length !== 1 ? "s" : ""} in range</p>
              </div>
              {rows.length === 0 ? (
                <p className="p-10 text-center text-sm font-semibold text-slate-400">No Daily Closings found in this range.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[960px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3 text-right">Cash Rev</th>
                        <th className="px-4 py-3 text-right">UPI</th>
                        <th className="px-4 py-3 text-right">Zomato</th>
                        <th className="px-4 py-3 text-right">Swiggy</th>
                        <th className="px-4 py-3 text-right">Other</th>
                        <th className="px-4 py-3 text-right">Total Rev</th>
                        <th className="px-4 py-3 text-right">Expenses</th>
                        <th className="px-4 py-3 text-right">Deposits</th>
                        <th className="px-4 py-3 text-right">Day P&amp;L</th>
                        <th className="px-4 py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const dayPnl = r.totalRevenue - r.cashExpenseTotal;
                        return (
                          <tr key={r.date} className="border-b border-slate-50 hover:bg-slate-50/50">
                            <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-700">{formatDateDisplay(r.date)}</td>
                            <td className="px-4 py-3 text-right text-emerald-600">{formatCurrency(r.cashRevenue)}</td>
                            <td className="px-4 py-3 text-right text-slate-500">{formatCurrency(r.upiSales)}</td>
                            <td className="px-4 py-3 text-right text-slate-500">{formatCurrency(r.zomatoSales)}</td>
                            <td className="px-4 py-3 text-right text-slate-500">{formatCurrency(r.swiggySales)}</td>
                            <td className="px-4 py-3 text-right text-slate-500">{formatCurrency(r.otherIncome)}</td>
                            <td className="px-4 py-3 text-right font-bold text-slate-900">{formatCurrency(r.totalRevenue)}</td>
                            <td className="px-4 py-3 text-right text-rose-600">{formatCurrency(r.cashExpenseTotal)}</td>
                            <td className="px-4 py-3 text-right text-sky-600">{formatCurrency(r.depositTotal)}</td>
                            <td
                              className={`px-4 py-3 text-right font-bold ${
                                r.locked ? (dayPnl >= 0 ? "text-emerald-600" : "text-rose-600") : "text-slate-300"
                              }`}
                            >
                              {r.locked ? formatCurrency(dayPnl) : "—"}
                            </td>
                            <td className="px-4 py-3">
                              {r.locked ? (
                                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-600">Closed</span>
                              ) : (
                                <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-600">Draft</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {s.closedDays > 0 && (
                      <tfoot>
                        <tr className="border-t border-slate-200 bg-slate-50 font-bold text-slate-900">
                          <td className="px-4 py-3 text-xs font-semibold text-slate-500">
                            Totals ({s.closedDays} closed)
                          </td>
                          <td className="px-4 py-3 text-right text-emerald-600">
                            {formatCurrency(rb?.cashSales ?? 0)}
                          </td>
                          <td className="px-4 py-3 text-right">{formatCurrency(rb?.upi ?? 0)}</td>
                          <td className="px-4 py-3 text-right">{formatCurrency(rb?.zomato ?? 0)}</td>
                          <td className="px-4 py-3 text-right">{formatCurrency(rb?.swiggy ?? 0)}</td>
                          <td className="px-4 py-3 text-right">{formatCurrency(rb?.otherIncome ?? 0)}</td>
                          <td className="px-4 py-3 text-right text-slate-900">{formatCurrency(s.totalRevenue)}</td>
                          <td className="px-4 py-3 text-right text-rose-600">{formatCurrency(s.totalExpense)}</td>
                          <td className="px-4 py-3 text-right text-sky-600">{formatCurrency(s.closingDeposits)}</td>
                          <td className={`px-4 py-3 text-right ${netPnl >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                            {formatCurrency(netPnl)}
                          </td>
                          <td className="px-4 py-3" />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
