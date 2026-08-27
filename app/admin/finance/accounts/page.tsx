"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Archive, Hourglass, Landmark, PiggyBank, Plus, RotateCcw, Wallet } from "lucide-react";
import { requireAdmin } from "@/lib/roleGuard";
import { firebaseAuthedFetch } from "@/lib/firebaseAuthFetch";
import { formatCurrency } from "@/lib/financeFormat";
import FinanceNav from "@/components/finance/FinanceNav";
import Modal from "@/components/finance/Modal";
import NativeSelectField from "@/components/ui/NativeSelectField";

type AccountType = "cash" | "bank" | "pigmi" | "wallet" | "escrow" | "other";

interface FinanceAccountRow {
  id: string;
  name: string;
  type: AccountType;
  openingBalance: number;
  currentBalance: number;
  status: "active" | "archived";
  description: string;
}

interface ReconciliationResult {
  storedBalance: number;
  computedBalance: number;
  drift: number;
  corrected: boolean;
}

interface CashDrawerRecountBackfillResult {
  daysChecked: number;
  openingCashDaysAdjusted: string[];
  daysAdjusted: string[];
  totalAdjustment: number;
  warnings: string[];
}

const TYPE_LABEL: Record<AccountType, string> = {
  cash: "Cash",
  bank: "Bank",
  pigmi: "Pigmi",
  wallet: "Wallet",
  escrow: "Escrow",
  other: "Other",
};

const TYPE_ICON: Record<AccountType, React.ComponentType<{ className?: string }>> = {
  cash: Wallet,
  bank: Landmark,
  pigmi: PiggyBank,
  wallet: Wallet,
  escrow: Hourglass,
  other: Wallet,
};

async function readJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) throw new Error(payload?.message || "Request failed.");
  return payload;
}

export default function FinanceAccountsPage() {
  const { authenticated, loading, role } = requireAdmin();

  const [accounts, setAccounts] = useState<FinanceAccountRow[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<FinanceAccountRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reconcileById, setReconcileById] = useState<Record<string, ReconciliationResult>>({});
  const [reconcileBusyId, setReconcileBusyId] = useState<string | null>(null);
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillResult, setBackfillResult] = useState<CashDrawerRecountBackfillResult | null>(null);
  const [backfillError, setBackfillError] = useState("");

  const [form, setForm] = useState({ name: "", type: "cash" as AccountType, openingBalance: "0", description: "" });

  const canQuery = authenticated && role === "admin";

  const load = async () => {
    setFetching(true);
    setError("");
    try {
      const response = await firebaseAuthedFetch(`/api/finance/accounts?includeArchived=${showArchived}`);
      const payload = await readJson(response);
      setAccounts(payload.accounts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load accounts.");
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    if (!canQuery) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canQuery, showArchived]);

  if (loading) {
    return <main className="min-h-screen bg-[#fff8ed] px-4 py-10 text-slate-900">Checking your session…</main>;
  }
  if (!authenticated || role !== "admin") return null;

  const openCreateModal = () => {
    setEditing(null);
    setForm({ name: "", type: "cash", openingBalance: "0", description: "" });
    setModalOpen(true);
  };

  const openEditModal = (account: FinanceAccountRow) => {
    setEditing(account);
    setForm({ name: account.name, type: account.type, openingBalance: String(account.openingBalance), description: account.description });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setError("Account name is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (editing) {
        const response = await firebaseAuthedFetch(`/api/finance/accounts/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: form.name, type: form.type, description: form.description }),
        });
        await readJson(response);
        setAccounts((prev) =>
          prev.map((a) => (a.id === editing.id ? { ...a, name: form.name, type: form.type, description: form.description } : a)),
        );
      } else {
        const response = await firebaseAuthedFetch("/api/finance/accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name,
            type: form.type,
            openingBalance: Number(form.openingBalance) || 0,
            description: form.description,
          }),
        });
        const payload = await readJson(response);
        setAccounts((prev) => [...prev, payload.account].sort((a, b) => a.name.localeCompare(b.name)));
      }
      setModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save account.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (account: FinanceAccountRow) => {
    const nextStatus = account.status === "active" ? "archived" : "active";
    setBusyId(account.id);
    setError("");
    try {
      const response = await firebaseAuthedFetch(`/api/finance/accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      await readJson(response);
      setAccounts((prev) => prev.map((a) => (a.id === account.id ? { ...a, status: nextStatus } : a)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update account.");
    } finally {
      setBusyId(null);
    }
  };

  const handleSeedDefaults = async () => {
    setSaving(true);
    setError("");
    try {
      const response = await firebaseAuthedFetch("/api/finance/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seedDefaults: true }),
      });
      await readJson(response);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to seed default accounts.");
    } finally {
      setSaving(false);
    }
  };

  const handleCheckBalance = async (account: FinanceAccountRow) => {
    setReconcileBusyId(account.id);
    setError("");
    try {
      const response = await firebaseAuthedFetch(`/api/finance/accounts/${account.id}/reconcile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply: false }),
      });
      const payload = await readJson(response);
      setReconcileById((prev) => ({ ...prev, [account.id]: payload.result }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to check balance.");
    } finally {
      setReconcileBusyId(null);
    }
  };

  const handleFixBalance = async (account: FinanceAccountRow) => {
    if (!window.confirm(`Set ${account.name}'s balance to match the ledger? This will be recorded in the audit trail.`)) return;
    setReconcileBusyId(account.id);
    setError("");
    try {
      const response = await firebaseAuthedFetch(`/api/finance/accounts/${account.id}/reconcile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply: true }),
      });
      const payload = await readJson(response);
      setReconcileById((prev) => ({ ...prev, [account.id]: payload.result }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fix balance.");
    } finally {
      setReconcileBusyId(null);
    }
  };

  const handleBackfillCashRecount = async () => {
    if (
      !window.confirm(
        "Walk through every closed day and post a Cash Recount Adjustment wherever the cash drawer's ledger balance doesn't match that day's Closing Cash? This posts real, visible transactions and is recorded in the audit trail.",
      )
    ) {
      return;
    }
    setBackfillBusy(true);
    setBackfillError("");
    try {
      const response = await firebaseAuthedFetch("/api/finance/closing/backfill-cash-recount", { method: "POST" });
      const payload = await readJson(response);
      setBackfillResult(payload.result);
      await load();
    } catch (err) {
      setBackfillError(err instanceof Error ? err.message : "Failed to sync the cash drawer to Daily Closing history.");
    } finally {
      setBackfillBusy(false);
    }
  };

  const totalBalance = accounts.filter((a) => a.status === "active").reduce((sum, a) => sum + a.currentBalance, 0);

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-orange-600">Finance</p>
          <h1 className="mt-1 text-3xl font-black">Accounts</h1>
          <p className="mt-2 text-sm text-slate-600">
            Every place DAJAJ&apos;s money lives — cash drawer, bank accounts, Pigmi, petty cash. Balances update automatically
            from the Transactions tab; nothing here should ever need manual arithmetic.
          </p>
          <div className="mt-5">
            <FinanceNav />
          </div>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-3">
            <p className="text-xs text-slate-500">Total across active accounts</p>
            <p className={`text-2xl font-black ${totalBalance < 0 ? "text-rose-600" : "text-slate-900"}`}>{formatCurrency(totalBalance)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              {showArchived ? "Hide archived" : "Show archived"}
            </button>
            {accounts.length === 0 && !fetching ? (
              <button
                type="button"
                onClick={handleSeedDefaults}
                disabled={saving}
                className="rounded-2xl border border-orange-300 bg-orange-50 px-4 py-2.5 text-sm font-semibold text-orange-700 transition hover:bg-orange-100 disabled:opacity-50"
              >
                Seed default accounts
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleBackfillCashRecount}
              disabled={backfillBusy}
              className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              {backfillBusy ? "Syncing…" : "Sync Cash Drawer to Daily Closing"}
            </button>
            <button
              type="button"
              onClick={openCreateModal}
              className="flex items-center gap-1.5 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              <Plus className="h-4 w-4" /> Add Account
            </button>
          </div>
        </div>

        {error ? (
          <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p>
        ) : null}

        {backfillError ? (
          <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{backfillError}</p>
        ) : null}

        {backfillResult ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <p className="font-semibold">
              Checked {backfillResult.daysChecked} closed day(s) — {backfillResult.openingCashDaysAdjusted.length} day(s) had Opening Cash
              corrected for external transfers, {backfillResult.daysAdjusted.length} Recount Adjustment(s) posted, total drift corrected{" "}
              {formatCurrency(backfillResult.totalAdjustment)}.
            </p>
            {backfillResult.warnings.length > 0 ? (
              <ul className="mt-1 list-inside list-disc text-xs text-emerald-700">
                {backfillResult.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {fetching ? (
          <p className="text-sm text-slate-500">Loading accounts…</p>
        ) : accounts.length === 0 ? (
          <div className="rounded-[28px] border border-slate-200 bg-white p-10 text-center shadow-sm">
            <p className="font-semibold text-slate-400">No accounts yet. Seed the defaults or add your first account.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {accounts.map((account) => {
              const Icon = TYPE_ICON[account.type];
              const archived = account.status === "archived";
              return (
                <article
                  key={account.id}
                  className={`rounded-[28px] border bg-white p-6 shadow-sm ${archived ? "border-slate-200 opacity-60" : "border-slate-200"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-600">
                        <Icon className="h-5 w-5" />
                      </span>
                      <div>
                        <p className="text-lg font-black text-slate-900">{account.name}</p>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{TYPE_LABEL[account.type]}</p>
                      </div>
                    </div>
                    {archived ? (
                      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500">Archived</span>
                    ) : null}
                  </div>

                  <p className={`mt-4 text-3xl font-black ${account.currentBalance < 0 ? "text-rose-600" : "text-slate-900"}`}>
                    {formatCurrency(account.currentBalance)}
                  </p>
                  {account.description ? <p className="mt-1 text-sm text-slate-500">{account.description}</p> : null}

                  {reconcileById[account.id] ? (
                    reconcileById[account.id].drift === 0 ? (
                      <p className="mt-3 rounded-2xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                        {reconcileById[account.id].corrected ? "Fixed — now matches the ledger." : "Matches the ledger."}
                      </p>
                    ) : (
                      <div className="mt-3 rounded-2xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        <p className="font-semibold">
                          Ledger says {formatCurrency(reconcileById[account.id].computedBalance)} (drift {reconcileById[account.id].drift > 0 ? "+" : ""}
                          {formatCurrency(reconcileById[account.id].drift)})
                        </p>
                        <button
                          type="button"
                          disabled={reconcileBusyId === account.id}
                          onClick={() => handleFixBalance(account)}
                          className="mt-1.5 rounded-xl border border-amber-300 bg-white px-3 py-1 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-50"
                        >
                          {reconcileBusyId === account.id ? "Fixing…" : "Fix Now"}
                        </button>
                      </div>
                    )
                  ) : null}

                  <div className="mt-5 flex flex-wrap gap-2">
                    <Link
                      href={`/admin/finance/accounts/statement?accountId=${account.id}`}
                      className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      Statement
                    </Link>
                    <button
                      type="button"
                      disabled={reconcileBusyId === account.id}
                      onClick={() => handleCheckBalance(account)}
                      className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                    >
                      {reconcileBusyId === account.id ? "Checking…" : "Check Balance"}
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditModal(account)}
                      className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={busyId === account.id}
                      onClick={() => handleToggleStatus(account)}
                      className="flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                    >
                      {archived ? <RotateCcw className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                      {archived ? "Restore" : "Archive"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {modalOpen ? (
        <Modal title={editing ? "Edit Account" : "Add Account"} onClose={() => setModalOpen(false)}>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Canara"
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">Type</label>
              <NativeSelectField
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as AccountType }))}
                displayValue={TYPE_LABEL[form.type]}
              >
                {Object.entries(TYPE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelectField>
            </div>
            {!editing ? (
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">Opening Balance</label>
                <input
                  type="number"
                  value={form.openingBalance}
                  onChange={(e) => setForm((f) => ({ ...f, openingBalance: e.target.value }))}
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                />
              </div>
            ) : (
              <p className="rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-500">
                Opening balance can&apos;t be changed after creation — post a Transfer or adjusting entry through Transactions
                instead, so the change is auditable.
              </p>
            )}
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleSave}
                className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </main>
  );
}
