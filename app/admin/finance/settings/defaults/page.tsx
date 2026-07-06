"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { requireAdmin } from "@/lib/roleGuard";
import { firebaseAuthedFetch } from "@/lib/firebaseAuthFetch";
import FinanceNav from "@/components/finance/FinanceNav";
import Modal from "@/components/finance/Modal";

interface FinanceDefaultRow {
  id: string;
  eventKey: string;
  eventName: string;
  destinationAccountId: string | null;
  destinationAccountName: string | null;
  description: string;
  isActive: boolean;
}

interface AccountOption {
  id: string;
  name: string;
  status: string;
}

async function readJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) throw new Error(payload?.message || "Request failed.");
  return payload;
}

export default function FinanceDefaultsPage() {
  const { authenticated, loading, role } = requireAdmin();
  const canQuery = authenticated && role === "admin";

  const [rows, setRows] = useState<FinanceDefaultRow[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addForm, setAddForm] = useState({ eventName: "", destinationAccountId: "", description: "" });
  const [addError, setAddError] = useState("");

  const load = async () => {
    setFetching(true);
    setError("");
    try {
      const [defaultsRes, accountsRes] = await Promise.all([
        firebaseAuthedFetch("/api/finance/defaults?includeInactive=true"),
        firebaseAuthedFetch("/api/finance/accounts"),
      ]);
      const [defaultsPayload, accountsPayload] = await Promise.all([readJson(defaultsRes), readJson(accountsRes)]);
      setRows(defaultsPayload.defaults);
      setAccounts(accountsPayload.accounts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Finance Defaults.");
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    if (!canQuery) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canQuery]);

  if (loading) {
    return <main className="min-h-screen bg-[#fff8ed] px-4 py-10 text-slate-900">Checking your session…</main>;
  }
  if (!authenticated || role !== "admin") return null;

  const activeAccounts = accounts.filter((a) => a.status === "active");

  const handleSeedDefaults = async () => {
    setSaving(true);
    setError("");
    try {
      await readJson(
        await firebaseAuthedFetch("/api/finance/defaults", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seedDefaults: true }),
        }),
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to seed Finance Defaults.");
    } finally {
      setSaving(false);
    }
  };

  const handleDestinationChange = async (row: FinanceDefaultRow, destinationAccountId: string) => {
    setBusyId(row.id);
    setError("");
    try {
      await readJson(
        await firebaseAuthedFetch(`/api/finance/defaults/${row.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ destinationAccountId: destinationAccountId || null }),
        }),
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update mapping.");
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleActive = async (row: FinanceDefaultRow) => {
    setBusyId(row.id);
    setError("");
    try {
      await readJson(
        await firebaseAuthedFetch(`/api/finance/defaults/${row.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: !row.isActive }),
        }),
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update event.");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (row: FinanceDefaultRow) => {
    if (!window.confirm(`Remove the "${row.eventName}" mapping?`)) return;
    setBusyId(row.id);
    setError("");
    try {
      await readJson(await firebaseAuthedFetch(`/api/finance/defaults/${row.id}`, { method: "DELETE" }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove event.");
    } finally {
      setBusyId(null);
    }
  };

  const handleAddEvent = async () => {
    setAddError("");
    if (!addForm.eventName.trim()) {
      setAddError("Event name is required.");
      return;
    }
    setSaving(true);
    try {
      await readJson(
        await firebaseAuthedFetch("/api/finance/defaults", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventName: addForm.eventName,
            destinationAccountId: addForm.destinationAccountId || null,
            description: addForm.description,
          }),
        }),
      );
      setAddModalOpen(false);
      setAddForm({ eventName: "", destinationAccountId: "", description: "" });
      await load();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add event.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-3xl space-y-5">
        <header className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-orange-600">Finance · Settings</p>
          <h1 className="mt-1 text-3xl font-black">Finance Defaults</h1>
          <p className="mt-2 text-sm text-slate-600">
            Configure where Daily Closing and other automatic financial events are posted. Accounts only hold balances —
            this is the one place that decides which account each event lands in. Changing a mapping only affects future
            transactions.
          </p>
          <div className="mt-5">
            <FinanceNav />
          </div>
        </header>

        {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p> : null}

        <div className="flex justify-end gap-2">
          {rows.length === 0 && !fetching ? (
            <button
              type="button"
              onClick={handleSeedDefaults}
              disabled={saving}
              className="rounded-2xl border border-orange-300 bg-orange-50 px-4 py-2.5 text-sm font-semibold text-orange-700 transition hover:bg-orange-100 disabled:opacity-50"
            >
              Seed default events
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setAddModalOpen(true)}
            className="flex items-center gap-1.5 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" /> Add Event
          </button>
        </div>

        <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
          {fetching ? (
            <p className="p-6 text-sm text-slate-500">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="p-10 text-center text-sm font-semibold text-slate-400">
              No events configured yet. Seed the defaults or add your first event.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rows.map((row) => (
                <li key={row.id} className={`flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between ${!row.isActive ? "opacity-50" : ""}`}>
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900">
                      {row.eventName}
                      {!row.isActive ? <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">Inactive</span> : null}
                    </p>
                    {row.description ? <p className="mt-0.5 text-xs text-slate-400">{row.description}</p> : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <select
                      value={row.destinationAccountId ?? ""}
                      disabled={busyId === row.id}
                      onChange={(e) => handleDestinationChange(row, e.target.value)}
                      className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-400 disabled:opacity-50"
                    >
                      <option value="">Not configured</option>
                      {activeAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => handleToggleActive(row)}
                      className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                    >
                      {row.isActive ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => handleDelete(row)}
                      className="text-slate-400 transition hover:text-rose-600 disabled:opacity-50"
                      aria-label="Remove"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {addModalOpen ? (
        <Modal title="Add Event" onClose={() => setAddModalOpen(false)}>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">Event Name</label>
              <input
                value={addForm.eventName}
                onChange={(e) => setAddForm((f) => ({ ...f, eventName: e.target.value }))}
                placeholder="e.g. Amazon Pay"
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">Destination Account</label>
              <select
                value={addForm.destinationAccountId}
                onChange={(e) => setAddForm((f) => ({ ...f, destinationAccountId: e.target.value }))}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              >
                <option value="">Not configured</option>
                {activeAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">Description (optional)</label>
              <input
                value={addForm.description}
                onChange={(e) => setAddForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              />
            </div>
            {addError ? <p className="text-sm font-medium text-rose-600">{addError}</p> : null}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setAddModalOpen(false)} className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button type="button" disabled={saving} onClick={handleAddEvent} className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </main>
  );
}
