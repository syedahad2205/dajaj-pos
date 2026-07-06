"use client";

import { useEffect, useState } from "react";
import { requireAdmin } from "@/lib/roleGuard";
import { firebaseAuthedFetch } from "@/lib/firebaseAuthFetch";
import { formatCurrency, formatDateDisplay, todayDateKey } from "@/lib/financeFormat";
import FinanceNav from "@/components/finance/FinanceNav";

interface DailyClosingRow {
  date: string;
  openingCash: number;
  cashExpenseTotal: number;
  depositTotal: number;
  totalCashOut: number;
  cashRevenue: number;
  upiSales: number;
  zomatoSales: number;
  swiggySales: number;
  otherIncome: number;
  totalRevenue: number;
  closingCash: number | null;
  locked: boolean;
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

export default function FinanceReportsPage() {
  const { authenticated, loading, role } = requireAdmin();
  const canQuery = authenticated && role === "admin";

  const [dateFrom, setDateFrom] = useState(firstDayOfThisMonth());
  const [dateTo, setDateTo] = useState(todayDateKey());
  const [rows, setRows] = useState<DailyClosingRow[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setFetching(true);
    setError("");
    try {
      const response = await firebaseAuthedFetch(`/api/finance/closing?dateFrom=${dateFrom}&dateTo=${dateTo}`);
      const payload = await readJson(response);
      setRows([...payload.closings].sort((a: DailyClosingRow, b: DailyClosingRow) => (a.date < b.date ? 1 : -1)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load reports.");
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    if (!canQuery) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canQuery, dateFrom, dateTo]);

  if (loading) {
    return <main className="min-h-screen bg-[#fff8ed] px-4 py-10 text-slate-900">Checking your session…</main>;
  }
  if (!authenticated || role !== "admin") return null;

  const totals = rows.reduce(
    (acc, r) => ({
      cashExpenseTotal: acc.cashExpenseTotal + r.cashExpenseTotal,
      depositTotal: acc.depositTotal + r.depositTotal,
      totalCashOut: acc.totalCashOut + r.totalCashOut,
      cashRevenue: acc.cashRevenue + r.cashRevenue,
      totalRevenue: acc.totalRevenue + r.totalRevenue,
    }),
    { cashExpenseTotal: 0, depositTotal: 0, totalCashOut: 0, cashRevenue: 0, totalRevenue: 0 },
  );

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-orange-600">Finance</p>
          <h1 className="mt-1 text-3xl font-black">Reports</h1>
          <p className="mt-2 text-sm text-slate-600">History of every Daily Closing. Detailed exports and P&amp;L breakdowns are planned for a later phase.</p>
          <div className="mt-5">
            <FinanceNav />
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-3 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-400" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">To</label>
            <input type="date" value={dateTo} max={todayDateKey()} onChange={(e) => setDateTo(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-400" />
          </div>
        </div>

        {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p> : null}

        <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
          {fetching ? (
            <p className="p-6 text-sm text-slate-500">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="p-10 text-center text-sm font-semibold text-slate-400">No Daily Closings in this range.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3 text-right">Opening Cash</th>
                    <th className="px-4 py-3 text-right">Cash Expense</th>
                    <th className="px-4 py-3 text-right">Cash Deposits</th>
                    <th className="px-4 py-3 text-right">Total Cash Out</th>
                    <th className="px-4 py-3 text-right">Cash Revenue</th>
                    <th className="px-4 py-3 text-right">UPI</th>
                    <th className="px-4 py-3 text-right">Zomato</th>
                    <th className="px-4 py-3 text-right">Swiggy</th>
                    <th className="px-4 py-3 text-right">Other</th>
                    <th className="px-4 py-3 text-right">Total Revenue</th>
                    <th className="px-4 py-3 text-right">Closing Cash</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.date} className="border-b border-slate-50">
                      <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-700">{formatDateDisplay(r.date)}</td>
                      <td className="px-4 py-3 text-right text-slate-500">{formatCurrency(r.openingCash)}</td>
                      <td className="px-4 py-3 text-right text-rose-600">{formatCurrency(r.cashExpenseTotal)}</td>
                      <td className="px-4 py-3 text-right text-sky-600">{formatCurrency(r.depositTotal)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-700">{formatCurrency(r.totalCashOut)}</td>
                      <td className="px-4 py-3 text-right text-emerald-600">{formatCurrency(r.cashRevenue)}</td>
                      <td className="px-4 py-3 text-right text-slate-500">{formatCurrency(r.upiSales)}</td>
                      <td className="px-4 py-3 text-right text-slate-500">{formatCurrency(r.zomatoSales)}</td>
                      <td className="px-4 py-3 text-right text-slate-500">{formatCurrency(r.swiggySales)}</td>
                      <td className="px-4 py-3 text-right text-slate-500">{formatCurrency(r.otherIncome)}</td>
                      <td className="px-4 py-3 text-right font-bold text-slate-900">{formatCurrency(r.totalRevenue)}</td>
                      <td className="px-4 py-3 text-right text-slate-500">{r.closingCash !== null ? formatCurrency(r.closingCash) : "—"}</td>
                      <td className="px-4 py-3">
                        {r.locked ? (
                          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-600">Closed</span>
                        ) : (
                          <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-600">Draft</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-bold text-slate-900">
                    <td className="px-4 py-3">Total</td>
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3 text-right">{formatCurrency(totals.cashExpenseTotal)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(totals.depositTotal)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(totals.totalCashOut)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(totals.cashRevenue)}</td>
                    <td className="px-4 py-3" colSpan={4} />
                    <td className="px-4 py-3 text-right">{formatCurrency(totals.totalRevenue)}</td>
                    <td className="px-4 py-3" colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
