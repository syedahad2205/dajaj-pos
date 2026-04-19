"use client";

import { useEffect, useState } from "react";
import { firebaseAuthedFetch } from "@/lib/firebaseAuthFetch";
import { requireAdmin } from "@/lib/roleGuard";

interface InventoryLogRow {
  id: string;
  itemId: string;
  date: string;
  userId: string;
  userName: string;
  actionType: string;
  field: string;
  oldValue: number | null;
  newValue: number | null;
  timestamp: string;
}

export default function AdminInventoryLogsPage() {
  const { authenticated, loading, role } = requireAdmin();
  const [logs, setLogs] = useState<InventoryLogRow[]>([]);
  const [status, setStatus] = useState("Loading audit logs…");

  useEffect(() => {
    if (loading) return;
    if (!authenticated || role !== "admin") return;

    void firebaseAuthedFetch("/api/inventory/logs")
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.message || "Failed to load logs.");
        }
        return response.json();
      })
      .then((payload) => {
        if (!payload.success) throw new Error(payload.message || "Failed to load logs.");
        setLogs(payload.logs.map((log: any) => ({
          ...log,
          timestamp: log.timestamp?.toDate ? log.timestamp.toDate().toISOString() : log.timestamp || "",
        })));
        setStatus("");
      })
      .catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : "Failed to load logs.");
      });
  }, [authenticated, loading, role]);

  if (loading) {
    return <main className="min-h-screen bg-[#fff8ed] px-4 py-10 text-slate-900">Checking your session…</main>;
  }

  if (!authenticated || role !== "admin") return null;

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
          <h1 className="text-3xl font-black">Inventory Audit Logs</h1>
          <p className="mt-2 text-sm text-slate-600">All inventory edits are immutable and recorded for review.</p>
        </header>

        {status ? (
          <div className="rounded-3xl border border-orange-100 bg-orange-50 px-6 py-4 text-sm text-slate-700">{status}</div>
        ) : null}

        <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-[0.16em] text-xs">
                <tr>
                  <th className="whitespace-nowrap px-4 py-4 text-left">Date</th>
                  <th className="px-4 py-4 text-left">Item</th>
                  <th className="px-4 py-4 text-left">Field</th>
                  <th className="px-4 py-4 text-right">Old</th>
                  <th className="px-4 py-4 text-right">New</th>
                  <th className="px-4 py-4 text-left">Action</th>
                  <th className="px-4 py-4 text-left">User</th>
                  <th className="px-4 py-4 text-left">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-slate-500">No inventory logs recorded yet.</td>
                  </tr>
                ) : logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-900">{log.date}</td>
                    <td className="px-4 py-3 text-slate-700">{log.itemId}</td>
                    <td className="px-4 py-3 text-slate-700">{log.field}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{log.oldValue ?? "—"}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{log.newValue ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-700">{log.actionType}</td>
                    <td className="px-4 py-3 text-slate-700">{log.userName || log.userId}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">{new Date(log.timestamp).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
