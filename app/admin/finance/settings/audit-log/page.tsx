"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { requireAdmin } from "@/lib/roleGuard";
import { firebaseAuthedFetch } from "@/lib/firebaseAuthFetch";
import FinanceNav from "@/components/finance/FinanceNav";
import type { FinanceAuditAction, FinanceAuditModule } from "@/lib/finance";

interface AuditLogRow {
  id: string;
  module: FinanceAuditModule;
  entityId: string;
  entityLabel: string;
  action: FinanceAuditAction;
  userId: string;
  userName: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
  timestamp?: { toDate?: () => Date } | null;
}

async function readJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) throw new Error(payload?.message || "Request failed.");
  return payload;
}

function formatTimestamp(ts: AuditLogRow["timestamp"]): string {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const MODULE_LABELS: Record<FinanceAuditModule, string> = {
  account: "Account",
  expense_category: "Expense Category",
  expense_subcategory: "Expense Subcategory",
  income_category: "Income Category",
  vendor: "Vendor",
  transaction: "Transaction",
  closing: "Daily Closing",
  closing_expense: "Daily Closing · Expense",
  closing_deposit: "Daily Closing · Deposit",
  finance_default: "Finance Default",
  finance_user: "Finance User",
};

const ACTION_STYLES: Record<FinanceAuditAction, string> = {
  create: "bg-emerald-50 text-emerald-700",
  enable: "bg-emerald-50 text-emerald-700",
  restore: "bg-emerald-50 text-emerald-700",
  login: "bg-emerald-50 text-emerald-700",
  update: "bg-sky-50 text-sky-700",
  close: "bg-slate-100 text-slate-700",
  backfill: "bg-slate-100 text-slate-700",
  password_change: "bg-slate-100 text-slate-700",
  reopen: "bg-amber-50 text-amber-700",
  delete: "bg-rose-50 text-rose-700",
  void: "bg-rose-50 text-rose-700",
  archive: "bg-rose-50 text-rose-700",
  disable: "bg-rose-50 text-rose-700",
};

function ActionBadge({ action }: { action: FinanceAuditAction }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${ACTION_STYLES[action] ?? "bg-slate-100 text-slate-600"}`}>{action.replace(/_/g, " ")}</span>;
}

function ValueBlock({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="min-w-0 flex-1">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <pre className="max-h-64 overflow-auto rounded-xl bg-slate-50 p-3 text-[11px] leading-5 text-slate-700">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

function AuditLogEntry({ entry }: { entry: AuditLogRow }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = entry.oldValue !== null || entry.newValue !== null;

  return (
    <li className="rounded-2xl border border-slate-100 bg-slate-50/60 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <ActionBadge action={entry.action} />
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{MODULE_LABELS[entry.module] ?? entry.module}</span>
          <span className="text-sm font-semibold text-slate-800">{entry.entityLabel || entry.entityId}</span>
        </div>
        <span className="whitespace-nowrap text-xs text-slate-400">{formatTimestamp(entry.timestamp)}</span>
      </div>

      <p className="mt-1.5 text-xs text-slate-500">
        By <span className="font-semibold text-slate-700">{entry.userName || entry.userId}</span>
        {entry.reason ? (
          <>
            {" "}
            · <span className="italic">&ldquo;{entry.reason}&rdquo;</span>
          </>
        ) : null}
      </p>

      {hasDetail ? (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-2 text-xs font-semibold text-orange-600 underline hover:text-orange-700">
          {expanded ? "Hide changes" : "View changes"}
        </button>
      ) : null}

      {expanded ? (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <ValueBlock label="Before" value={entry.oldValue} />
          <ValueBlock label="After" value={entry.newValue} />
        </div>
      ) : null}
    </li>
  );
}

export default function FinanceAuditLogPage() {
  const { authenticated, loading, role } = requireAdmin();
  const canQuery = authenticated && role === "admin";

  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  const [moduleFilter, setModuleFilter] = useState<"all" | FinanceAuditModule>("all");
  const [search, setSearch] = useState("");
  const [limitCount, setLimitCount] = useState(200);

  const load = async () => {
    setFetching(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: String(limitCount) });
      if (moduleFilter !== "all") params.set("module", moduleFilter);
      const response = await firebaseAuthedFetch(`/api/finance/audit-logs?${params.toString()}`);
      const payload = await readJson(response);
      setLogs(payload.logs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the audit log.");
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    if (!canQuery) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canQuery, moduleFilter, limitCount]);

  const visibleLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter(
      (l) => l.userName.toLowerCase().includes(q) || l.entityLabel.toLowerCase().includes(q) || l.entityId.toLowerCase().includes(q),
    );
  }, [logs, search]);

  if (loading) {
    return <main className="min-h-screen bg-[#fff8ed] px-4 py-10 text-slate-900">Checking your session…</main>;
  }
  if (!authenticated || role !== "admin") return null;

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-orange-600">Finance · Settings</p>
          <h1 className="mt-1 text-3xl font-black">Audit Log</h1>
          <p className="mt-2 text-sm text-slate-600">
            Every finance change, from every account — Admin and Finance Manager alike. Who did what, when, and why, with the
            before/after values for anything that was edited or removed.
          </p>
          <div className="mt-5">
            <FinanceNav role={role} />
          </div>
        </header>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by person or entity…"
            className="flex-1 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
          />
          <div className="relative">
            <select
              value={moduleFilter}
              onChange={(e) => setModuleFilter(e.target.value as typeof moduleFilter)}
              className="appearance-none rounded-2xl border border-slate-300 bg-white px-4 py-3 pr-9 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
            >
              <option value="all">All Modules</option>
              {(Object.keys(MODULE_LABELS) as FinanceAuditModule[]).map((m) => (
                <option key={m} value={m}>
                  {MODULE_LABELS[m]}
                </option>
              ))}
            </select>
            <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" strokeWidth={2.5} />
          </div>
        </div>

        {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p> : null}

        <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          {fetching ? (
            <p className="p-6 text-center text-sm text-slate-500">Loading audit log…</p>
          ) : visibleLogs.length === 0 ? (
            <p className="p-10 text-center text-sm font-semibold text-slate-400">No matching activity found.</p>
          ) : (
            <ul className="space-y-2">
              {visibleLogs.map((entry) => (
                <AuditLogEntry key={entry.id} entry={entry} />
              ))}
            </ul>
          )}

          {!fetching && logs.length >= limitCount ? (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => setLimitCount((n) => n + 200)}
                className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Load older entries
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
