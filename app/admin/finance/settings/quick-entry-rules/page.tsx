"use client";

import { useEffect, useState } from "react";
import { requireAdmin } from "@/lib/roleGuard";
import { firebaseAuthedFetch } from "@/lib/firebaseAuthFetch";
import FinanceNav from "@/components/finance/FinanceNav";
import NativeSelectField from "@/components/ui/NativeSelectField";

interface CategoryOption {
  id: string;
  name: string;
  active: boolean;
}
interface PayeeRule {
  id: string;
  payeeLabel: string;
  categoryId: string;
  categoryName: string;
  active: boolean;
}

async function readJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) throw new Error(payload?.message || "Request failed.");
  return payload;
}

export default function QuickEntryRulesPage() {
  const { authenticated, loading, role } = requireAdmin();

  const [rules, setRules] = useState<PayeeRule[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  const [newRule, setNewRule] = useState({ payeeLabel: "", categoryId: "" });
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setFetching(true);
    setError("");
    try {
      const [rulesRes, catRes] = await Promise.all([
        firebaseAuthedFetch("/api/finance/quick-entry/payee-rules?includeInactive=true"),
        firebaseAuthedFetch("/api/finance/expense-categories"),
      ]);
      const [rulesP, catP] = await Promise.all([readJson(rulesRes), readJson(catRes)]);
      setRules(rulesP.rules);
      setCategories(catP.categories.filter((c: CategoryOption) => c.active));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load payee rules.");
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    if (!authenticated || role !== "admin") return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, role]);

  if (loading) {
    return <main className="min-h-screen bg-[#fff8ed] px-4 py-10 text-slate-900">Checking your session…</main>;
  }
  if (!authenticated || role !== "admin") return null;

  const handleSeedDefaults = async () => {
    setSaving(true);
    setError("");
    try {
      await readJson(
        await firebaseAuthedFetch("/api/finance/quick-entry/payee-rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seedDefaults: true }),
        }),
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to seed default rules.");
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = async () => {
    if (!newRule.payeeLabel.trim() || !newRule.categoryId) {
      setError("Enter a payee and choose a category.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await readJson(
        await firebaseAuthedFetch("/api/finance/quick-entry/payee-rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payeeLabel: newRule.payeeLabel, categoryId: newRule.categoryId }),
        }),
      );
      setNewRule({ payeeLabel: "", categoryId: "" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add rule.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (rule: PayeeRule) => {
    setBusyId(rule.id);
    try {
      await readJson(
        await firebaseAuthedFetch(`/api/finance/quick-entry/payee-rules/${rule.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ active: !rule.active }),
        }),
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update rule.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-3xl space-y-5">
        <header className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-orange-600">Finance</p>
          <h1 className="mt-1 text-3xl font-black">Quick Entry — Payee Rules</h1>
          <p className="mt-2 text-sm text-slate-600">
            When a payment&apos;s payee matches one of these, Quick Entry auto-selects the mapped expense category — overriding any AI
            suggestion. Built-in: Fayeeq MH → Chicken Expense, Sana Bakery → Khuboos Expense.
          </p>
          <div className="mt-5">
            <FinanceNav />
          </div>
        </header>

        {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p> : null}

        <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Add a rule</p>
          <div className="flex flex-wrap gap-3">
            <input
              value={newRule.payeeLabel}
              onChange={(e) => setNewRule((f) => ({ ...f, payeeLabel: e.target.value }))}
              placeholder="Payee text, e.g. XYZ Gas"
              className="min-w-[200px] flex-1 rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-orange-400"
            />
            <NativeSelectField
              value={newRule.categoryId}
              onChange={(e) => setNewRule((f) => ({ ...f, categoryId: e.target.value }))}
              displayValue={categories.find((c) => c.id === newRule.categoryId)?.name ?? "Category…"}
              placeholder={!newRule.categoryId}
              className="min-w-[180px]"
            >
              <option value="">Select…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelectField>
            <button
              type="button"
              disabled={saving}
              onClick={handleAdd}
              className="rounded-2xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              Add Rule
            </button>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={handleSeedDefaults}
            className="mt-3 text-xs font-semibold text-orange-600 hover:underline disabled:opacity-50"
          >
            Re-seed built-in rules (Fayeeq MH, Sana Bakery)
          </button>
        </section>

        <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
          {fetching ? (
            <p className="p-6 text-sm text-slate-500">Loading rules…</p>
          ) : rules.length === 0 ? (
            <p className="p-10 text-center text-sm font-semibold text-slate-400">No payee rules yet.</p>
          ) : (
            <ul className="divide-y divide-slate-50">
              {rules.map((rule) => (
                <li key={rule.id} className={`flex items-center justify-between gap-3 px-5 py-3 ${!rule.active ? "opacity-50" : ""}`}>
                  <div>
                    <p className="text-sm font-bold text-slate-900">{rule.payeeLabel}</p>
                    <p className="text-xs text-slate-500">→ {rule.categoryName}</p>
                  </div>
                  <button
                    type="button"
                    disabled={busyId === rule.id}
                    onClick={() => handleToggleActive(rule)}
                    className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {rule.active ? "Deactivate" : "Activate"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
