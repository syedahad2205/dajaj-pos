"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { requireFinanceAccess } from "@/lib/roleGuard";
import { firebaseAuthedFetch } from "@/lib/firebaseAuthFetch";
import { formatCurrency, formatDateShort } from "@/lib/financeFormat";
import FinanceNav from "@/components/finance/FinanceNav";
import BreakdownBars from "@/components/finance/BreakdownBars";

interface DashboardSummary {
  cards: {
    todayCashRevenue: number;
    todayCashExpense: number;
    todayPigmiDeposit: number;
    todayTotalRevenue: number;
    todayProfit: number;
    cashOnHand: number;
    pigmiBalance: number;
    bankBalance: number;
    pendingSettlements: number;
    monthlyRevenue: number;
    monthlyExpense: number;
    monthlyProfit: number;
  };
  revenueExpenseTrend: { date: string; revenue: number; expense: number; netCashFlow: number }[];
  categoryWiseExpenses: { label: string; amount: number }[];
  incomeSources: { label: string; amount: number }[];
  topExpenseCategories: { label: string; amount: number }[];
}

async function readJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) throw new Error(payload?.message || "Request failed.");
  return payload;
}

function StatCard({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "positive" | "negative" | "muted" }) {
  const toneClass = tone === "positive" ? "text-emerald-600" : tone === "negative" ? "text-rose-600" : tone === "muted" ? "text-slate-400" : "text-slate-900";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-black ${toneClass}`}>{value}</p>
    </div>
  );
}

export default function FinanceDashboardPage() {
  const { authenticated, loading, role } = requireFinanceAccess();
  const hasFinanceAccess = authenticated && (role === "admin" || role === "financeManager");
  const canQuery = hasFinanceAccess;

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!canQuery) return;
    setFetching(true);
    setError("");
    firebaseAuthedFetch("/api/finance/dashboard")
      .then(readJson)
      .then((payload) => setSummary(payload.summary))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load dashboard."))
      .finally(() => setFetching(false));
  }, [canQuery]);

  if (loading) {
    return <main className="min-h-screen bg-[#fff8ed] px-4 py-10 text-slate-900">Checking your session…</main>;
  }
  if (!hasFinanceAccess) return null;

  const maxTrend = summary ? Math.max(...summary.revenueExpenseTrend.map((d) => Math.max(d.revenue, d.expense)), 1) : 1;

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-orange-600">Finance</p>
          <h1 className="mt-1 text-3xl font-black">Finance Dashboard</h1>
          <p className="mt-2 text-sm text-slate-600">The financial health of DAJAJ, at a glance — combining Daily Closing and Transactions.</p>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <FinanceNav role={role} />
            <Link href="/admin/finance/closing" className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800">
              ⭐ Daily Closing
            </Link>
          </div>
        </header>

        {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p> : null}

        {fetching || !summary ? (
          <p className="text-sm text-slate-500">Loading dashboard…</p>
        ) : (
          <>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Today</p>
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
                <StatCard label="Cash Revenue" value={formatCurrency(summary.cards.todayCashRevenue)} tone="positive" />
                <StatCard label="Cash Expense" value={formatCurrency(summary.cards.todayCashExpense)} tone="negative" />
                <StatCard label="Pigmi Deposit" value={formatCurrency(summary.cards.todayPigmiDeposit)} tone="muted" />
                <StatCard label="Total Revenue" value={formatCurrency(summary.cards.todayTotalRevenue)} tone="positive" />
              </div>
              <p className="mt-1 text-xs text-slate-400">Shows ₹0 until today&apos;s Daily Closing is saved.</p>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Balances</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="Cash on Hand" value={formatCurrency(summary.cards.cashOnHand)} tone={summary.cards.cashOnHand < 0 ? "negative" : "default"} />
                <StatCard label="Bank Balance" value={formatCurrency(summary.cards.bankBalance)} />
                <StatCard label="Pending Settlements" value={formatCurrency(summary.cards.pendingSettlements)} tone="muted" />
                <StatCard label="Pigmi Balance (all-time deposits)" value={formatCurrency(summary.cards.pigmiBalance)} />
              </div>
              <p className="mt-1 text-xs text-slate-400">Pending Settlements = revenue recognized (e.g. Zomato/Swiggy Sales) but not yet settled into a bank account.</p>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">This Month</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <StatCard label="Monthly Revenue" value={formatCurrency(summary.cards.monthlyRevenue)} tone="positive" />
                <StatCard label="Monthly Expense" value={formatCurrency(summary.cards.monthlyExpense)} tone="negative" />
                <StatCard label="Monthly Profit" value={formatCurrency(summary.cards.monthlyProfit)} tone={summary.cards.monthlyProfit >= 0 ? "positive" : "negative"} />
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
              <p className="mb-4 text-sm font-black text-slate-900">Revenue vs Expense — last 14 days</p>
              <div className="flex h-40 items-end gap-0.5 sm:gap-2">
                {summary.revenueExpenseTrend.map((day) => (
                  <div key={day.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                    <div className="flex h-32 w-full items-end justify-center gap-0.5">
                      <div
                        className="w-1/2 rounded-t bg-emerald-400"
                        style={{ height: `${Math.max(2, (day.revenue / maxTrend) * 100)}%` }}
                        title={`Revenue: ${formatCurrency(day.revenue)}`}
                      />
                      <div
                        className="w-1/2 rounded-t bg-rose-300"
                        style={{ height: `${Math.max(2, (day.expense / maxTrend) * 100)}%` }}
                        title={`Expense: ${formatCurrency(day.expense)}`}
                      />
                    </div>
                    <span className="w-full truncate text-center text-[9px] text-slate-400 sm:text-[10px]">{formatDateShort(day.date)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" /> Revenue
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-rose-300" /> Expense
                </span>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                <p className="mb-4 text-sm font-black text-slate-900">Category-wise Expenses (this month)</p>
                <BreakdownBars items={summary.categoryWiseExpenses} barColorClassName="bg-rose-400" />
              </div>
              <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                <p className="mb-4 text-sm font-black text-slate-900">Revenue Sources (this month)</p>
                <BreakdownBars items={summary.incomeSources} barColorClassName="bg-emerald-400" />
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
