"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { requireAdmin } from "@/lib/roleGuard";
import { firebaseAuthedFetch } from "@/lib/firebaseAuthFetch";
import { formatCurrency, formatDateDisplay, todayDateKey } from "@/lib/financeFormat";
import FinanceNav from "@/components/finance/FinanceNav";

interface AccountOption {
  id: string;
  name: string;
  status: "active" | "archived";
}

interface StatementRow {
  transactionId: string;
  date: string;
  time: string;
  type: "income" | "expense" | "transfer";
  label: string;
  remarks: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

interface Statement {
  accountId: string;
  accountName: string;
  dateFrom: string;
  dateTo: string;
  openingBalance: number;
  closingBalance: number;
  totalDebits: number;
  totalCredits: number;
  rows: StatementRow[];
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

function AccountStatementContent() {
  const { authenticated, loading, role } = requireAdmin();
  const canQuery = authenticated && role === "admin";
  const searchParams = useSearchParams();

  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountId, setAccountId] = useState(searchParams?.get("accountId") ?? "");
  const [dateFrom, setDateFrom] = useState(firstDayOfThisMonth());
  const [dateTo, setDateTo] = useState(todayDateKey());
  const [statement, setStatement] = useState<Statement | null>(null);
  const [fetchingAccounts, setFetchingAccounts] = useState(true);
  const [fetchingStatement, setFetchingStatement] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!canQuery) return;
    firebaseAuthedFetch("/api/finance/accounts?includeArchived=true")
      .then(readJson)
      .then((payload) => {
        setAccounts(payload.accounts);
        if (!accountId && payload.accounts.length > 0) {
          setAccountId(payload.accounts[0].id);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load accounts."))
      .finally(() => setFetchingAccounts(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canQuery]);

  useEffect(() => {
    if (!canQuery || !accountId) return;
    setFetchingStatement(true);
    setError("");
    firebaseAuthedFetch(`/api/finance/accounts/${accountId}/statement?dateFrom=${dateFrom}&dateTo=${dateTo}`)
      .then(readJson)
      .then((payload) => setStatement(payload.statement))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load statement."))
      .finally(() => setFetchingStatement(false));
  }, [canQuery, accountId, dateFrom, dateTo]);

  if (loading) {
    return <main className="min-h-screen bg-[#fff8ed] px-4 py-10 text-slate-900">Checking your session…</main>;
  }
  if (!authenticated || role !== "admin") return null;

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-orange-600">Finance</p>
          <h1 className="mt-1 text-3xl font-black">Account Statement</h1>
          <p className="mt-2 text-sm text-slate-600">Every transaction that hit one account, with a running balance — like a bank statement.</p>
          <div className="mt-5">
            <FinanceNav />
          </div>
        </header>

        <div className="flex flex-wrap items-end gap-3 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">Account</label>
            <select
              value={accountId}
              disabled={fetchingAccounts}
              onChange={(e) => setAccountId(e.target.value)}
              className="min-w-[200px] rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-orange-400 disabled:opacity-50"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.status === "archived" ? " (Archived)" : ""}
                </option>
              ))}
            </select>
          </div>
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

        {fetchingAccounts ? (
          <p className="text-sm text-slate-500">Loading accounts…</p>
        ) : accounts.length === 0 ? (
          <div className="rounded-[28px] border border-slate-200 bg-white p-10 text-center shadow-sm">
            <p className="font-semibold text-slate-400">No accounts configured yet.</p>
          </div>
        ) : fetchingStatement || !statement ? (
          <p className="text-sm text-slate-500">Loading statement…</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Opening Balance</p>
                <p className={`mt-1 text-xl font-black ${statement.openingBalance < 0 ? "text-rose-600" : "text-slate-900"}`}>{formatCurrency(statement.openingBalance)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Total Debits</p>
                <p className="mt-1 text-xl font-black text-rose-600">{formatCurrency(statement.totalDebits)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Total Credits</p>
                <p className="mt-1 text-xl font-black text-emerald-600">{formatCurrency(statement.totalCredits)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Closing Balance</p>
                <p className={`mt-1 text-xl font-black ${statement.closingBalance < 0 ? "text-rose-600" : "text-slate-900"}`}>{formatCurrency(statement.closingBalance)}</p>
              </div>
            </div>

            <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
              {statement.rows.length === 0 ? (
                <p className="p-10 text-center text-sm font-semibold text-slate-400">No transactions in this range for {statement.accountName}.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">Description</th>
                        <th className="px-4 py-3 text-right">Debit</th>
                        <th className="px-4 py-3 text-right">Credit</th>
                        <th className="px-4 py-3 text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-slate-50 bg-slate-50/60">
                        <td className="px-4 py-2.5 text-xs text-slate-400" colSpan={4}>
                          Opening Balance ({formatDateDisplay(statement.dateFrom)})
                        </td>
                        <td className="px-4 py-2.5 text-right text-sm font-bold text-slate-700">{formatCurrency(statement.openingBalance)}</td>
                      </tr>
                      {statement.rows.map((row) => (
                        <tr key={row.transactionId} className="border-b border-slate-50">
                          <td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatDateDisplay(row.date)}</td>
                          <td className="px-4 py-3 text-slate-700">
                            {row.label}
                            {row.remarks ? <span className="block text-xs text-slate-400">{row.remarks}</span> : null}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-rose-600">{row.debit > 0 ? formatCurrency(row.debit) : "—"}</td>
                          <td className="px-4 py-3 text-right font-semibold text-emerald-600">{row.credit > 0 ? formatCurrency(row.credit) : "—"}</td>
                          <td className={`px-4 py-3 text-right font-bold ${row.runningBalance < 0 ? "text-rose-600" : "text-slate-900"}`}>{formatCurrency(row.runningBalance)}</td>
                        </tr>
                      ))}
                    </tbody>
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

export default function AccountStatementPage() {
  return (
    <Suspense>
      <AccountStatementContent />
    </Suspense>
  );
}
