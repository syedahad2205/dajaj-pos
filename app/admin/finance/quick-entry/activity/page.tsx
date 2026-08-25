"use client";

import { useEffect, useState } from "react";
import { requireFinanceAccess } from "@/lib/roleGuard";
import { firebaseAuthedFetch } from "@/lib/firebaseAuthFetch";
import FinanceNav from "@/components/finance/FinanceNav";

type QuickEntryActivityAction =
  | "login"
  | "logout"
  | "screenshot_uploaded"
  | "screenshot_analyzed"
  | "ai_unavailable"
  | "transaction_created"
  | "transaction_creation_failed"
  | "transaction_viewed"
  | "transaction_cancelled"
  | "category_changed"
  | "account_changed"
  | "duplicate_warning_shown"
  | "duplicate_confirmed"
  | "auth_failure";

interface ActivityLogRow {
  id: string;
  action: QuickEntryActivityAction;
  detail: Record<string, unknown>;
  transactionId: string | null;
  userId: string;
  userName: string;
  timestamp?: { seconds: number; nanoseconds: number } | string;
}

const ACTION_LABELS: Record<QuickEntryActivityAction, string> = {
  login: "Logged in",
  logout: "Logged out",
  screenshot_uploaded: "Uploaded a screenshot",
  screenshot_analyzed: "AI analysed a screenshot",
  ai_unavailable: "AI reader was unavailable",
  transaction_created: "Transaction created",
  transaction_creation_failed: "Transaction creation failed",
  transaction_viewed: "Viewed a transaction",
  transaction_cancelled: "Cancelled an entry",
  category_changed: "Changed the expense category",
  account_changed: "Changed the account",
  duplicate_warning_shown: "Duplicate warning shown",
  duplicate_confirmed: "Confirmed as not a duplicate",
  auth_failure: "Sign-in failed",
};

const ACTION_TONE: Partial<Record<QuickEntryActivityAction, string>> = {
  transaction_created: "text-emerald-700 bg-emerald-100",
  transaction_creation_failed: "text-rose-700 bg-rose-100",
  ai_unavailable: "text-amber-700 bg-amber-100",
  duplicate_warning_shown: "text-amber-700 bg-amber-100",
  auth_failure: "text-rose-700 bg-rose-100",
};

function formatTimestamp(value: ActivityLogRow["timestamp"]): string {
  if (!value) return "—";
  if (typeof value === "string") return new Date(value).toLocaleString("en-IN");
  if (typeof value === "object" && "seconds" in value) return new Date(value.seconds * 1000).toLocaleString("en-IN");
  return "—";
}

async function readJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) throw new Error(payload?.message || "Request failed.");
  return payload;
}

export default function QuickEntryActivityPage() {
  const { authenticated, loading, role } = requireFinanceAccess();
  const hasFinanceAccess = authenticated && (role === "admin" || role === "financeManager");

  const [logs, setLogs] = useState<ActivityLogRow[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!hasFinanceAccess) return;
    firebaseAuthedFetch("/api/finance/quick-entry/activity")
      .then(readJson)
      .then((payload) => setLogs(payload.logs ?? []))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load activity log."))
      .finally(() => setFetching(false));
  }, [hasFinanceAccess]);

  if (loading) {
    return <main className="min-h-screen bg-[#fff8ed] px-4 py-10 text-slate-900">Checking your session…</main>;
  }
  if (!hasFinanceAccess) return null;

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-orange-600">Finance</p>
          <h1 className="mt-1 text-3xl font-black">Activity Log</h1>
          <p className="mt-2 text-sm text-slate-600">
            {role === "admin" ? "Every Finance Manager's Quick Entry activity." : "Your own Quick Entry activity — uploads, analyses, and saves."}
          </p>
          <div className="mt-5">
            <FinanceNav role={role} />
          </div>
        </header>

        {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p> : null}

        <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
          {fetching ? (
            <p className="p-6 text-sm text-slate-500">Loading activity…</p>
          ) : logs.length === 0 ? (
            <p className="p-10 text-center text-sm font-semibold text-slate-400">No Quick Entry activity yet.</p>
          ) : (
            <ul className="divide-y divide-slate-50">
              {logs.map((log) => (
                <li key={log.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <div>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ACTION_TONE[log.action] ?? "bg-slate-100 text-slate-600"}`}>
                      {ACTION_LABELS[log.action] ?? log.action}
                    </span>
                    <span className="ml-2 text-sm text-slate-600">{log.userName}</span>
                  </div>
                  <span className="text-xs text-slate-400">{formatTimestamp(log.timestamp)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
