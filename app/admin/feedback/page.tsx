"use client";

import { useEffect, useState } from "react";
import { requireAdmin } from "@/lib/roleGuard";
import {
  deleteFeedback,
  getAllFeedback,
  markFeedbackReviewed,
  type FeedbackRecord,
  type FeedbackStatus,
} from "@/services/feedbackService";
import { CheckCircle, Trash2 } from "lucide-react";

type FilterValue = "all" | FeedbackStatus;

function formatDate(value: unknown): string {
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return "Just now";
}

export default function AdminFeedbackPage() {
  const { authenticated, loading: authLoading, role } = requireAdmin();

  const [records, setRecords] = useState<FeedbackRecord[]>([]);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterValue>("all");
  const [actionId, setActionId] = useState<string | null>(null);

  useEffect(() => {
    if (!authenticated || role !== "admin") return;

    setFetching(true);
    getAllFeedback()
      .then(setRecords)
      .catch(() => setError("Failed to load feedback. Please refresh."))
      .finally(() => setFetching(false));
  }, [authenticated, role]);

  if (authLoading) {
    return (
      <main className="min-h-screen bg-[#fff8ed] px-4 py-10 text-slate-900">
        Checking your session…
      </main>
    );
  }

  if (!authenticated || role !== "admin") return null;

  // ── Filter + search ────────────────────────────────────────────────────────

  const searchLower = search.toLowerCase().trim();

  const visible = records.filter((r) => {
    const matchesFilter = filter === "all" || r.status === filter;
    if (!matchesFilter) return false;
    if (!searchLower) return true;

    return (
      r.customerName.toLowerCase().includes(searchLower) ||
      r.userEmail.toLowerCase().includes(searchLower) ||
      (r.mobileNumber ?? "").includes(searchLower)
    );
  });

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleMarkReviewed = async (id: string) => {
    setActionId(id);
    setError("");
    try {
      await markFeedbackReviewed(id);
      setRecords((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: "reviewed" } : r)),
      );
    } catch {
      setError("Failed to update status.");
    } finally {
      setActionId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this feedback? This cannot be undone.")) return;
    setActionId(id);
    setError("");
    try {
      await deleteFeedback(id);
      setRecords((prev) => prev.filter((r) => r.id !== id));
    } catch {
      setError("Failed to delete feedback.");
    } finally {
      setActionId(null);
    }
  };

  // ── Stats ──────────────────────────────────────────────────────────────────

  const newCount = records.filter((r) => r.status === "new").length;
  const reviewedCount = records.filter((r) => r.status === "reviewed").length;

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-5xl space-y-5">

        {/* Header */}
        <header className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-orange-600">
            Admin
          </p>
          <h1 className="mt-1 text-3xl font-black">Customer Feedback</h1>
          <p className="mt-2 text-sm text-slate-600">
            Review all feedback submitted by customers via QR code.
          </p>

          {/* Stats row */}
          <div className="mt-5 flex flex-wrap gap-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-3 text-center">
              <p className="text-2xl font-black text-slate-900">{records.length}</p>
              <p className="text-xs text-slate-500">Total</p>
            </div>
            <div className="rounded-2xl border border-orange-200 bg-orange-50 px-5 py-3 text-center">
              <p className="text-2xl font-black text-orange-700">{newCount}</p>
              <p className="text-xs text-orange-600">New</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-3 text-center">
              <p className="text-2xl font-black text-slate-500">{reviewedCount}</p>
              <p className="text-xs text-slate-400">Reviewed</p>
            </div>
          </div>
        </header>

        {/* Search + filter */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, or mobile…"
            className="flex-1 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
          />
          <div className="flex gap-2">
            {(["all", "new", "reviewed"] as FilterValue[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-2xl px-4 py-2.5 text-sm font-semibold capitalize transition ${
                  filter === f
                    ? "bg-slate-900 text-white"
                    : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
            {error}
          </p>
        ) : null}

        {fetching ? (
          <p className="text-sm text-slate-500">Loading feedback…</p>
        ) : visible.length === 0 ? (
          <div className="rounded-[28px] border border-slate-200 bg-white p-10 text-center shadow-sm">
            <p className="font-semibold text-slate-400">No feedback found.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {visible.map((r) => (
              <article
                key={r.id}
                className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  {/* Left */}
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-lg font-black text-slate-900">
                        {r.customerName}
                      </p>
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          r.status === "new"
                            ? "bg-orange-100 text-orange-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {r.status === "new" ? "New" : "Reviewed"}
                      </span>
                    </div>
                    <p className="text-sm text-slate-500">{r.userEmail}</p>
                    {r.mobileNumber ? (
                      <p className="text-sm text-slate-500">+91 {r.mobileNumber}</p>
                    ) : null}
                    <p className="text-xs text-slate-400">{formatDate(r.createdAt)}</p>
                  </div>

                  {/* Actions */}
                  <div className="flex shrink-0 gap-2">
                    {r.status === "new" ? (
                      <button
                        type="button"
                        disabled={actionId === r.id}
                        onClick={() => handleMarkReviewed(r.id)}
                        title="Mark as reviewed"
                        className="flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                      >
                        <CheckCircle className="h-4 w-4" aria-hidden="true" />
                        Mark Reviewed
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={actionId === r.id}
                      onClick={() => handleDelete(r.id)}
                      title="Delete feedback"
                      className="flex items-center gap-1.5 rounded-xl border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      Delete
                    </button>
                  </div>
                </div>

                {/* Feedback text */}
                <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-4">
                  <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
                    {r.feedback}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
