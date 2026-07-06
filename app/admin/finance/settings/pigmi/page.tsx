"use client";

import { useEffect, useState } from "react";
import { requireAdmin } from "@/lib/roleGuard";
import { firebaseAuthedFetch } from "@/lib/firebaseAuthFetch";
import { formatCurrency, formatDateDisplay, todayDateKey } from "@/lib/financeFormat";
import FinanceNav from "@/components/finance/FinanceNav";

interface DepositEntry {
  type: string;
  amount: number;
}

interface DailyClosingRow {
  date: string;
  deposits: DepositEntry[];
  locked: boolean;
}

interface PigmiDayTotal {
  date: string;
  amount: number;
}

async function readJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) throw new Error(payload?.message || "Request failed.");
  return payload;
}

/** Sum of just the Pigmi-type deposits on one Daily Closing day. */
function pigmiTotalFor(closing: DailyClosingRow): number {
  return closing.deposits.filter((d) => d.type === "pigmi").reduce((sum, d) => sum + d.amount, 0);
}

export default function PigmiSettingsPage() {
  const { authenticated, loading, role } = requireAdmin();
  const canQuery = authenticated && role === "admin";

  const [rows, setRows] = useState<PigmiDayTotal[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!canQuery) return;
    setFetching(true);
    setError("");
    firebaseAuthedFetch(`/api/finance/closing?dateFrom=2000-01-01&dateTo=${todayDateKey()}`)
      .then(readJson)
      .then((payload) => {
        const withPigmi: PigmiDayTotal[] = (payload.closings as DailyClosingRow[])
          .map((c) => ({ date: c.date, amount: pigmiTotalFor(c) }))
          .filter((r) => r.amount > 0)
          .reverse();
        setRows(withPigmi);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load Pigmi history."))
      .finally(() => setFetching(false));
  }, [canQuery]);

  if (loading) {
    return <main className="min-h-screen bg-[#fff8ed] px-4 py-10 text-slate-900">Checking your session…</main>;
  }
  if (!authenticated || role !== "admin") return null;

  const totalAllTime = rows.reduce((sum, r) => sum + r.amount, 0);
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const totalThisMonth = rows.filter((r) => r.date >= monthStart).reduce((sum, r) => sum + r.amount, 0);

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-3xl space-y-5">
        <header className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-orange-600">Finance · Settings</p>
          <h1 className="mt-1 text-3xl font-black">Pigmi Settings</h1>
          <p className="mt-2 text-sm text-slate-600">
            Pigmi deposits are recorded independently on the Daily Closing screen, under Cash Deposits — cash moved out of the
            drawer, reducing what&apos;s on hand, but never counted as a business expense. This is a running record of what&apos;s
            gone into Pigmi so far. Reconciling it against actual bank deposits is a future feature.
          </p>
          <div className="mt-5">
            <FinanceNav />
          </div>
        </header>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">All-Time Pigmi Deposits</p>
            <p className="mt-1 text-2xl font-black text-slate-900">{formatCurrency(totalAllTime)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">This Month</p>
            <p className="mt-1 text-2xl font-black text-slate-900">{formatCurrency(totalThisMonth)}</p>
          </div>
        </div>

        {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p> : null}

        <section className="rounded-[28px] border border-slate-200 bg-white shadow-sm">
          {fetching ? (
            <p className="p-6 text-sm text-slate-500">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="p-10 text-center text-sm font-semibold text-slate-400">No Pigmi deposits recorded yet.</p>
          ) : (
            <ul className="divide-y divide-slate-50">
              {rows.map((r) => (
                <li key={r.date} className="flex items-center justify-between px-5 py-3 text-sm">
                  <span className="text-slate-600">{formatDateDisplay(r.date)}</span>
                  <span className="font-bold text-sky-600">{formatCurrency(r.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
