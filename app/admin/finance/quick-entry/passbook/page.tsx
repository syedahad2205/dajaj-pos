"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { requireFinanceAccess } from "@/lib/roleGuard";
import { firebaseAuthedFetch } from "@/lib/firebaseAuthFetch";
import { formatCurrency, formatDateDisplay, todayDateKey } from "@/lib/financeFormat";
import FinanceNav from "@/components/finance/FinanceNav";
import NativeDateField from "@/components/ui/NativeDateField";

interface AccountOption {
  id: string;
  name: string;
  type: string;
  status: "active" | "archived";
  currentBalance: number;
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

type Preset = "today" | "week" | "month" | "custom";

async function readJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) throw new Error(payload?.message || "Request failed.");
  return payload;
}

function firstDayOfThisWeek(): string {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday
  const diff = (day + 6) % 7; // days since Monday
  now.setDate(now.getDate() - diff);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function firstDayOfThisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function PassbookContent() {
  const { authenticated, loading, role } = requireFinanceAccess();
  const hasFinanceAccess = authenticated && (role === "admin" || role === "financeManager");
  const searchParams = useSearchParams();
  const today = todayDateKey();

  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountId, setAccountId] = useState(searchParams?.get("accountId") ?? "");
  const [preset, setPreset] = useState<Preset>("month");
  const [dateFrom, setDateFrom] = useState(firstDayOfThisMonth());
  const [dateTo, setDateTo] = useState(today);
  const [search, setSearch] = useState("");
  const [statement, setStatement] = useState<Statement | null>(null);
  const [fetchingAccounts, setFetchingAccounts] = useState(true);
  const [fetchingStatement, setFetchingStatement] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!hasFinanceAccess) return;
    firebaseAuthedFetch("/api/finance/accounts")
      .then(readJson)
      .then((payload) => {
        const active = (payload.accounts as AccountOption[]).filter((a) => a.status === "active");
        setAccounts(active);
        if (!accountId && active.length > 0) setAccountId(active[0].id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load accounts."))
      .finally(() => setFetchingAccounts(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasFinanceAccess]);

  useEffect(() => {
    if (!hasFinanceAccess || !accountId) return;
    setFetchingStatement(true);
    setError("");
    firebaseAuthedFetch(`/api/finance/accounts/${accountId}/statement?dateFrom=${dateFrom}&dateTo=${dateTo}`)
      .then(readJson)
      .then((payload) => setStatement(payload.statement))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load passbook."))
      .finally(() => setFetchingStatement(false));
  }, [hasFinanceAccess, accountId, dateFrom, dateTo]);

  const applyPreset = (next: Preset) => {
    setPreset(next);
    if (next === "today") {
      setDateFrom(today);
      setDateTo(today);
    } else if (next === "week") {
      setDateFrom(firstDayOfThisWeek());
      setDateTo(today);
    } else if (next === "month") {
      setDateFrom(firstDayOfThisMonth());
      setDateTo(today);
    }
  };

  const filteredRows = useMemo(() => {
    if (!statement) return [];
    const needle = search.trim().toLowerCase();
    const rows = needle ? statement.rows.filter((r) => `${r.label} ${r.remarks}`.toLowerCase().includes(needle)) : statement.rows;
    // getAccountStatement returns rows oldest-first (it has to, to walk the
    // running balance forward correctly) — reverse only for display so the
    // passbook reads latest-on-top, like a bank app. Each row already
    // carries its own correct running balance from that forward walk, so
    // reversing here is purely cosmetic and doesn't touch the math.
    return [...rows].reverse();
  }, [statement, search]);

  if (loading) {
    return <main className="min-h-screen bg-[#fff8ed] px-4 py-10 text-slate-900">Checking your session…</main>;
  }
  if (!hasFinanceAccess) return null;

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-orange-600">Finance</p>
          <h1 className="mt-1 text-3xl font-black">Accounts / Passbook</h1>
          <p className="mt-2 text-sm text-slate-600">Pick an account to see every payment that hit it, with a running balance.</p>
          <div className="mt-5">
            <FinanceNav role={role} />
          </div>
        </header>

        {fetchingAccounts ? (
          <p className="text-sm text-slate-500">Loading accounts…</p>
        ) : accounts.length === 0 ? (
          <div className="rounded-[28px] border border-slate-200 bg-white p-10 text-center shadow-sm">
            <p className="font-semibold text-slate-400">No accounts configured yet.</p>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {accounts.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAccountId(a.id)}
                  className={`rounded-2xl border p-4 text-left shadow-sm transition ${
                    accountId === a.id ? "border-orange-400 bg-orange-50" : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                >
                  <p className="text-sm font-black text-slate-900">{a.name}</p>
                  <p className="text-xs uppercase tracking-wide text-slate-400">{a.type}</p>
                  <p className={`mt-1 text-lg font-black ${a.currentBalance < 0 ? "text-rose-600" : "text-slate-900"}`}>{formatCurrency(a.currentBalance)}</p>
                </button>
              ))}
            </div>

            <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap gap-2">
                {(["today", "week", "month", "custom"] as Preset[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => applyPreset(p)}
                    className={`rounded-xl px-3 py-1.5 text-xs font-semibold capitalize transition ${
                      preset === p ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {p === "week" ? "This Week" : p === "month" ? "This Month" : p === "today" ? "Today" : "Custom"}
                  </button>
                ))}
              </div>
              {preset === "custom" ? (
                <div className="mt-3 flex flex-wrap gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-500">From</label>
                    <NativeDateField value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-500">To</label>
                    <NativeDateField value={dateTo} max={today} onChange={(e) => setDateTo(e.target.value)} />
                  </div>
                </div>
              ) : null}
              <div className="mt-3">
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search category, payee, or notes…"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-400"
                />
              </div>
            </section>

            {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p> : null}

            {fetchingStatement || !statement ? (
              <p className="text-sm text-slate-500">Loading passbook…</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
                  <p className="border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Latest first
                  </p>
                  {filteredRows.length === 0 ? (
                    <p className="p-10 text-center text-sm font-semibold text-slate-400">No transactions match this filter for {statement.accountName}.</p>
                  ) : (
                    <ul className="divide-y divide-slate-50">
                      {filteredRows.map((row) => (
                        <li key={row.transactionId} className="flex items-start justify-between gap-3 px-4 py-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold text-slate-900">{row.label}</p>
                            {row.remarks ? <p className="truncate text-xs text-slate-400">{row.remarks}</p> : null}
                            <p className="mt-0.5 text-xs text-slate-400">
                              {formatDateDisplay(row.date)}
                              {row.time ? ` · ${row.time}` : ""}
                            </p>
                          </div>
                          <div className="flex-shrink-0 text-right">
                            <p className={`text-sm font-bold ${row.debit > 0 ? "text-rose-600" : row.credit > 0 ? "text-emerald-600" : "text-slate-400"}`}>
                              {row.debit > 0 ? `-${formatCurrency(row.debit)}` : row.credit > 0 ? `+${formatCurrency(row.credit)}` : "—"}
                            </p>
                            <p className={`text-xs ${row.runningBalance < 0 ? "text-rose-500" : "text-slate-400"}`}>Bal {formatCurrency(row.runningBalance)}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}

export default function PassbookPage() {
  return (
    <Suspense>
      <PassbookContent />
    </Suspense>
  );
}
