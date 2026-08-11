"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { requireAdmin } from "@/lib/roleGuard";
import { firebaseAuthedFetch } from "@/lib/firebaseAuthFetch";
import { formatCurrency, formatDateDisplay, todayDateKey } from "@/lib/financeFormat";
import FinanceNav from "@/components/finance/FinanceNav";
import NativeDateField from "@/components/ui/NativeDateField";

interface DailyClosingRow {
  date: string;
  totalRevenue: number;
  locked: boolean;
  closedByName: string | null;
  closingTime: string | null;
  reopenCount: number;
  postingWarnings: string[];
  needsBackfill: boolean;
  missingEventKeys: string[];
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

export default function LockSettingsPage() {
  const { authenticated, loading, role } = requireAdmin();
  const canQuery = authenticated && role === "admin";

  const [dateFrom, setDateFrom] = useState(firstDayOfThisMonth());
  const [dateTo, setDateTo] = useState(todayDateKey());
  const [rows, setRows] = useState<DailyClosingRow[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  const [busyDate, setBusyDate] = useState<string | null>(null);
  const [backfillingAll, setBackfillingAll] = useState(false);
  const [backfillSummary, setBackfillSummary] = useState("");

  const load = async () => {
    setFetching(true);
    setError("");
    try {
      const response = await firebaseAuthedFetch(`/api/finance/closing?dateFrom=${dateFrom}&dateTo=${dateTo}`);
      const payload = await readJson(response);
      setRows([...payload.closings].sort((a: DailyClosingRow, b: DailyClosingRow) => (a.date < b.date ? 1 : -1)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load closings.");
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

  const needsBackfill = rows.filter((r) => r.needsBackfill);

  const handleReopen = async (date: string) => {
    const reason = window.prompt(`Reason for reopening ${date}?`);
    if (!reason?.trim()) return;
    setBusyDate(date);
    setError("");
    try {
      await readJson(
        await firebaseAuthedFetch(`/api/finance/closing/${date}/reopen`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        }),
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reopen this day.");
    } finally {
      setBusyDate(null);
    }
  };

  const handleBackfill = async (date: string) => {
    setBusyDate(date);
    setError("");
    try {
      await readJson(await firebaseAuthedFetch(`/api/finance/closing/${date}/backfill`, { method: "POST" }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to backfill ${date}.`);
    } finally {
      setBusyDate(null);
    }
  };

  const handleBackfillAll = async () => {
    setBackfillingAll(true);
    setBackfillSummary("");
    setError("");
    let succeeded = 0;
    let stillWarning = 0;
    for (const row of needsBackfill) {
      try {
        const payload = await readJson(await firebaseAuthedFetch(`/api/finance/closing/${row.date}/backfill`, { method: "POST" }));
        if (payload.postedEventKeys?.length > 0) succeeded += 1;
        if (payload.closing?.postingWarnings?.length > 0) stillWarning += 1;
      } catch {
        stillWarning += 1;
      }
    }
    setBackfillSummary(
      `Backfilled ${succeeded} day(s).${stillWarning > 0 ? ` ${stillWarning} still have unconfigured events — check Finance Defaults.` : ""}`,
    );
    setBackfillingAll(false);
    await load();
  };

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-3xl space-y-5">
        <header className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-orange-600">Finance · Settings</p>
          <h1 className="mt-1 text-3xl font-black">Lock Settings</h1>
          <p className="mt-2 text-sm text-slate-600">
            Once a day is saved via Daily Closing it locks automatically — no more edits. Reopen a day here if something needs
            correcting; a reason is required and it&apos;s recorded in the audit trail. If a day&apos;s sales weren&apos;t posted to an
            account because Finance Defaults wasn&apos;t configured yet at the time, use Backfill instead — it retries just the
            missing postings without touching anything that already worked.
          </p>
          <div className="mt-5">
            <FinanceNav />
          </div>
        </header>

        <div className="flex flex-wrap items-end justify-between gap-3 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">From</label>
              <NativeDateField value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">To</label>
              <NativeDateField value={dateTo} max={todayDateKey()} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>
          {needsBackfill.length > 0 ? (
            <button
              type="button"
              disabled={backfillingAll}
              onClick={handleBackfillAll}
              className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {backfillingAll ? "Backfilling…" : `Backfill All (${needsBackfill.length})`}
            </button>
          ) : null}
        </div>

        {backfillSummary ? <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{backfillSummary}</p> : null}
        {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p> : null}

        <section className="rounded-[28px] border border-slate-200 bg-white shadow-sm">
          {fetching ? (
            <p className="p-6 text-sm text-slate-500">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="p-10 text-center text-sm font-semibold text-slate-400">No Daily Closings in this range.</p>
          ) : (
            <ul className="divide-y divide-slate-50">
              {rows.map((r) => {
                const flagged = r.needsBackfill;
                return (
                  <li key={r.date} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <Link href={`/admin/finance/closing?date=${r.date}`} className="text-sm font-bold text-slate-800 hover:underline">
                        {formatDateDisplay(r.date)}
                      </Link>
                      <p className="text-xs text-slate-400">
                        {r.locked ? `Closed ${r.closingTime ?? ""} by ${r.closedByName ?? "—"}` : "Not yet closed"}
                        {r.reopenCount > 0 ? ` · reopened ${r.reopenCount}x` : ""}
                      </p>
                      {flagged ? (
                        <p className="mt-1 text-xs font-semibold text-amber-600">{r.missingEventKeys.length} event(s) not posted to an account</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-700">{formatCurrency(r.totalRevenue)}</span>
                      {r.locked ? (
                        <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-600">Locked</span>
                      ) : (
                        <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-600">Open</span>
                      )}
                      {flagged ? (
                        <button
                          type="button"
                          disabled={busyDate === r.date || backfillingAll}
                          onClick={() => handleBackfill(r.date)}
                          className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-50"
                        >
                          Backfill
                        </button>
                      ) : null}
                      {r.locked ? (
                        <button
                          type="button"
                          disabled={busyDate === r.date || backfillingAll}
                          onClick={() => handleReopen(r.date)}
                          className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                        >
                          Reopen
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
