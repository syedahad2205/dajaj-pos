"use client";

import { useEffect, useState } from "react";
import { Archive, ChevronDown, ChevronRight, Plus, RotateCcw } from "lucide-react";
import { requireAdmin } from "@/lib/roleGuard";
import { firebaseAuthedFetch } from "@/lib/firebaseAuthFetch";
import FinanceNav from "@/components/finance/FinanceNav";
import Modal from "@/components/finance/Modal";

interface ExpenseCategoryRow {
  id: string;
  name: string;
  active: boolean;
  description: string;
  color: string;
  transactionCount: number;
}
interface ExpenseSubcategoryRow {
  id: string;
  categoryId: string;
  name: string;
  active: boolean;
  transactionCount: number;
}
interface IncomeCategoryRow {
  id: string;
  name: string;
  active: boolean;
  description: string;
  color: string;
  transactionCount: number;
}

async function readJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) throw new Error(payload?.message || "Request failed.");
  return payload;
}

export default function FinanceCategoriesPage() {
  const { authenticated, loading, role } = requireAdmin();
  const canQuery = authenticated && role === "admin";

  const [tab, setTab] = useState<"expense" | "income">("expense");
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategoryRow[]>([]);
  const [subcategoriesByCategory, setSubcategoriesByCategory] = useState<Record<string, ExpenseSubcategoryRow[]>>({});
  const [incomeCategories, setIncomeCategories] = useState<IncomeCategoryRow[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [categoryModal, setCategoryModal] = useState<{ kind: "expense" | "income"; editing: { id: string; name: string; description: string } | null } | null>(null);
  const [categoryForm, setCategoryForm] = useState({ name: "", description: "" });
  const [subcategoryModal, setSubcategoryModal] = useState<{ categoryId: string; editing: { id: string; name: string } | null } | null>(null);
  const [subcategoryName, setSubcategoryName] = useState("");

  const load = async () => {
    setFetching(true);
    setError("");
    try {
      const [expenseRes, incomeRes] = await Promise.all([
        firebaseAuthedFetch("/api/finance/expense-categories?includeInactive=true"),
        firebaseAuthedFetch("/api/finance/income-categories?includeInactive=true"),
      ]);
      const [expensePayload, incomePayload] = await Promise.all([readJson(expenseRes), readJson(incomeRes)]);
      setExpenseCategories(expensePayload.categories);
      setIncomeCategories(incomePayload.categories);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load categories.");
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    if (!canQuery) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canQuery]);

  const loadSubcategories = async (categoryId: string) => {
    try {
      const response = await firebaseAuthedFetch(`/api/finance/expense-subcategories?categoryId=${categoryId}&includeInactive=true`);
      const payload = await readJson(response);
      setSubcategoriesByCategory((prev) => ({ ...prev, [categoryId]: payload.subcategories }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load subcategories.");
    }
  };

  const toggleExpand = (categoryId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else {
        next.add(categoryId);
        if (!subcategoriesByCategory[categoryId]) void loadSubcategories(categoryId);
      }
      return next;
    });
  };

  if (loading) {
    return <main className="min-h-screen bg-[#fff8ed] px-4 py-10 text-slate-900">Checking your session…</main>;
  }
  if (!authenticated || role !== "admin") return null;

  const handleSeedDefaults = async () => {
    setSaving(true);
    setError("");
    try {
      const response = await firebaseAuthedFetch("/api/finance/expense-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seedDefaults: true }),
      });
      await readJson(response);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to seed default categories.");
    } finally {
      setSaving(false);
    }
  };

  const openCategoryModal = (kind: "expense" | "income", editing?: ExpenseCategoryRow | IncomeCategoryRow) => {
    setCategoryModal({ kind, editing: editing ? { id: editing.id, name: editing.name, description: editing.description } : null });
    setCategoryForm({ name: editing?.name ?? "", description: editing?.description ?? "" });
  };

  const handleSaveCategory = async () => {
    if (!categoryModal || !categoryForm.name.trim()) {
      setError("Category name is required.");
      return;
    }
    setSaving(true);
    setError("");
    const base = categoryModal.kind === "expense" ? "/api/finance/expense-categories" : "/api/finance/income-categories";
    try {
      if (categoryModal.editing) {
        const response = await firebaseAuthedFetch(`${base}/${categoryModal.editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: categoryForm.name, description: categoryForm.description }),
        });
        await readJson(response);
      } else {
        const response = await firebaseAuthedFetch(base, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: categoryForm.name, description: categoryForm.description }),
        });
        await readJson(response);
      }
      setCategoryModal(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save category.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleCategoryActive = async (kind: "expense" | "income", category: ExpenseCategoryRow | IncomeCategoryRow) => {
    const base = kind === "expense" ? "/api/finance/expense-categories" : "/api/finance/income-categories";
    setSaving(true);
    setError("");
    try {
      const response = await firebaseAuthedFetch(`${base}/${category.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !category.active }),
      });
      await readJson(response);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update category.");
    } finally {
      setSaving(false);
    }
  };

  const openSubcategoryModal = (categoryId: string, editing?: ExpenseSubcategoryRow) => {
    setSubcategoryModal({ categoryId, editing: editing ? { id: editing.id, name: editing.name } : null });
    setSubcategoryName(editing?.name ?? "");
  };

  const handleSaveSubcategory = async () => {
    if (!subcategoryModal || !subcategoryName.trim()) {
      setError("Subcategory name is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (subcategoryModal.editing) {
        const response = await firebaseAuthedFetch(`/api/finance/expense-subcategories/${subcategoryModal.editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: subcategoryName }),
        });
        await readJson(response);
      } else {
        const response = await firebaseAuthedFetch("/api/finance/expense-subcategories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ categoryId: subcategoryModal.categoryId, name: subcategoryName }),
        });
        await readJson(response);
      }
      setSubcategoryModal(null);
      await loadSubcategories(subcategoryModal.categoryId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save subcategory.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleSubcategoryActive = async (categoryId: string, subcategory: ExpenseSubcategoryRow) => {
    setSaving(true);
    setError("");
    try {
      const response = await firebaseAuthedFetch(`/api/finance/expense-subcategories/${subcategory.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !subcategory.active }),
      });
      await readJson(response);
      await loadSubcategories(categoryId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update subcategory.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-orange-600">Finance</p>
          <h1 className="mt-1 text-3xl font-black">Categories</h1>
          <p className="mt-2 text-sm text-slate-600">
            Manage what every rupee gets tagged as. Categories with transactions can&apos;t be deleted — archive them instead so
            historical reports stay intact.
          </p>
          <div className="mt-5">
            <FinanceNav />
          </div>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTab("expense")}
              className={`rounded-2xl px-4 py-2.5 text-sm font-semibold transition ${tab === "expense" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              Expense Categories
            </button>
            <button
              type="button"
              onClick={() => setTab("income")}
              className={`rounded-2xl px-4 py-2.5 text-sm font-semibold transition ${tab === "income" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              Income Categories
            </button>
          </div>
          <div className="flex gap-2">
            {tab === "expense" && expenseCategories.length === 0 && !fetching ? (
              <button
                type="button"
                onClick={handleSeedDefaults}
                disabled={saving}
                className="rounded-2xl border border-orange-300 bg-orange-50 px-4 py-2.5 text-sm font-semibold text-orange-700 transition hover:bg-orange-100 disabled:opacity-50"
              >
                Seed defaults
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => openCategoryModal(tab)}
              className="flex items-center gap-1.5 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              <Plus className="h-4 w-4" /> Add {tab === "expense" ? "Expense" : "Income"} Category
            </button>
          </div>
        </div>

        {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p> : null}

        {fetching ? (
          <p className="text-sm text-slate-500">Loading categories…</p>
        ) : tab === "expense" ? (
          expenseCategories.length === 0 ? (
            <div className="rounded-[28px] border border-slate-200 bg-white p-10 text-center shadow-sm">
              <p className="font-semibold text-slate-400">No expense categories yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {expenseCategories.map((category) => {
                const isOpen = expanded.has(category.id);
                const subs = subcategoriesByCategory[category.id] ?? [];
                return (
                  <div key={category.id} className={`rounded-[24px] border bg-white shadow-sm ${category.active ? "border-slate-200" : "border-slate-200 opacity-60"}`}>
                    <div className="flex items-center justify-between gap-3 p-5">
                      <button type="button" onClick={() => toggleExpand(category.id)} className="flex flex-1 items-center gap-2 text-left">
                        {isOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                        <div>
                          <p className="font-black text-slate-900">
                            {category.name}
                            {!category.active ? <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">Archived</span> : null}
                          </p>
                          <p className="text-xs text-slate-400">{category.transactionCount} transaction(s)</p>
                        </div>
                      </button>
                      <div className="flex shrink-0 gap-2">
                        <button type="button" onClick={() => openSubcategoryModal(category.id)} className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                          + Subcategory
                        </button>
                        <button type="button" onClick={() => openCategoryModal("expense", category)} className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleCategoryActive("expense", category)}
                          className="flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          {category.active ? <Archive className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
                          {category.active ? "Archive" : "Restore"}
                        </button>
                      </div>
                    </div>
                    {isOpen ? (
                      <div className="border-t border-slate-100 bg-slate-50/60 p-5">
                        {subs.length === 0 ? (
                          <p className="text-sm text-slate-400">No subcategories yet.</p>
                        ) : (
                          <ul className="space-y-2">
                            {subs.map((sub) => (
                              <li key={sub.id} className="flex items-center justify-between rounded-2xl bg-white px-4 py-2.5 shadow-sm">
                                <span className={`text-sm font-semibold ${sub.active ? "text-slate-800" : "text-slate-400 line-through"}`}>{sub.name}</span>
                                <div className="flex gap-2">
                                  <button type="button" onClick={() => openSubcategoryModal(category.id, sub)} className="text-xs font-semibold text-slate-500 hover:text-slate-800">
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleToggleSubcategoryActive(category.id, sub)}
                                    className="text-xs font-semibold text-slate-500 hover:text-slate-800"
                                  >
                                    {sub.active ? "Archive" : "Restore"}
                                  </button>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )
        ) : incomeCategories.length === 0 ? (
          <div className="rounded-[28px] border border-slate-200 bg-white p-10 text-center shadow-sm">
            <p className="font-semibold text-slate-400">No income categories yet.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {incomeCategories.map((category) => (
              <div key={category.id} className={`rounded-2xl border bg-white p-5 shadow-sm ${category.active ? "border-slate-200" : "border-slate-200 opacity-60"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-black text-slate-900">
                      {category.name}
                      {!category.active ? <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">Archived</span> : null}
                    </p>
                    <p className="text-xs text-slate-400">{category.transactionCount} transaction(s)</p>
                    {category.description ? <p className="mt-1 text-sm text-slate-500">{category.description}</p> : null}
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <button type="button" onClick={() => openCategoryModal("income", category)} className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleCategoryActive("income", category)}
                    className="flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    {category.active ? <Archive className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
                    {category.active ? "Archive" : "Restore"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {categoryModal ? (
        <Modal title={`${categoryModal.editing ? "Edit" : "Add"} ${categoryModal.kind === "expense" ? "Expense" : "Income"} Category`} onClose={() => setCategoryModal(null)}>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">Name</label>
              <input
                value={categoryForm.name}
                onChange={(e) => setCategoryForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">Description</label>
              <textarea
                value={categoryForm.description}
                onChange={(e) => setCategoryForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setCategoryModal(null)} className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button type="button" disabled={saving} onClick={handleSaveCategory} className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {subcategoryModal ? (
        <Modal title={subcategoryModal.editing ? "Edit Subcategory" : "Add Subcategory"} onClose={() => setSubcategoryModal(null)}>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">Name</label>
              <input
                value={subcategoryName}
                onChange={(e) => setSubcategoryName(e.target.value)}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setSubcategoryModal(null)} className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button type="button" disabled={saving} onClick={handleSaveSubcategory} className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </main>
  );
}
