"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { requireAdmin } from "@/lib/roleGuard";
import { firebaseAuthedFetch } from "@/lib/firebaseAuthFetch";
import { formatCurrency, todayDateKey } from "@/lib/financeFormat";
import { roundCurrency, SUPPORTED_CASH_DEPOSIT_TYPES, CASH_DEPOSIT_TYPE_LABELS, type CashDepositType, type FinanceExpenseSubcategory } from "@/lib/finance";
import FinanceNav from "@/components/finance/FinanceNav";
import Modal from "@/components/finance/Modal";

interface ExpenseEntry {
  id: string;
  categoryId: string;
  categoryName: string;
  subcategoryId: string | null;
  subcategoryName: string | null;
  amount: number;
  remarks: string;
}

interface ExpenseDraftRow {
  key: string;
  categoryId: string;
  subcategoryId: string;
  amount: string;
  remarks: string;
}

interface DepositEntry {
  id: string;
  type: CashDepositType;
  typeLabel: string;
  amount: number;
  remarks: string;
}

interface DailyClosing {
  date: string;
  openingCash: number;
  openingCashSource: "chained" | "manual";
  expenses: ExpenseEntry[];
  cashExpenseTotal: number;
  deposits: DepositEntry[];
  depositTotal: number;
  totalCashOut: number;
  upiSales: number;
  zomatoSales: number;
  swiggySales: number;
  otherIncome: number;
  closingCash: number | null;
  cashRevenue: number;
  totalRevenue: number;
  locked: boolean;
  closingTime: string | null;
  closedByName: string | null;
  reopenCount: number;
  postingWarnings: string[];
}

interface ExpenseCategoryOption {
  id: string;
  name: string;
  active: boolean;
}

async function readJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) throw new Error(payload?.message || "Request failed.");
  return payload;
}

function SummaryRow({ label, value, emphasis, muted }: { label: string; value: string; emphasis?: boolean; muted?: boolean }) {
  return (
    <div className={`flex items-center justify-between border-b border-slate-50 py-2 text-sm last:border-0 ${emphasis ? "text-base" : ""}`}>
      <span className={muted ? "text-slate-400" : "text-slate-600"}>{label}</span>
      <span className={`font-bold ${emphasis ? "text-slate-900" : muted ? "text-slate-400" : "text-slate-800"}`}>{value}</span>
    </div>
  );
}

function FinanceClosingContent() {
  const { authenticated, loading, role } = requireAdmin();
  const canQuery = authenticated && role === "admin";
  const today = todayDateKey();
  const searchParams = useSearchParams();

  const [date, setDate] = useState(searchParams?.get("date") || today);
  const [closing, setClosing] = useState<DailyClosing | null>(null);
  const [categories, setCategories] = useState<ExpenseCategoryOption[]>([]);
  const [subcategories, setSubcategories] = useState<FinanceExpenseSubcategory[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Local, instantly-reactive drafts so the summary card updates as the manager types,
  // without waiting on a round trip for every keystroke.
  const [salesDraft, setSalesDraft] = useState({ upiSales: "0", zomatoSales: "0", swiggySales: "0", otherIncome: "0" });
  const [closingCashDraft, setClosingCashDraft] = useState("");
  const [openingCashDraft, setOpeningCashDraft] = useState("0");

  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [expenseRows, setExpenseRows] = useState<ExpenseDraftRow[]>([{ key: "row-0", categoryId: "", subcategoryId: "", amount: "", remarks: "" }]);
  const [expenseSaving, setExpenseSaving] = useState(false);
  const [expenseError, setExpenseError] = useState("");

  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [depositForm, setDepositForm] = useState<{ type: CashDepositType; amount: string; remarks: string }>({
    type: SUPPORTED_CASH_DEPOSIT_TYPES[0],
    amount: "",
    remarks: "",
  });
  const [depositSaving, setDepositSaving] = useState(false);
  const [depositError, setDepositError] = useState("");

  const load = async () => {
    setFetching(true);
    setError("");
    try {
      const [closingRes, categoriesRes, subcategoriesRes] = await Promise.all([
        firebaseAuthedFetch(`/api/finance/closing/${date}`),
        firebaseAuthedFetch("/api/finance/expense-categories"),
        firebaseAuthedFetch("/api/finance/expense-subcategories"),
      ]);
      const [closingPayload, categoriesPayload, subcategoriesPayload] = await Promise.all([
        readJson(closingRes),
        readJson(categoriesRes),
        readJson(subcategoriesRes),
      ]);
      const c: DailyClosing = closingPayload.closing;
      setClosing(c);
      setCategories(categoriesPayload.categories);
      setSubcategories(subcategoriesPayload.subcategories ?? []);
      setSalesDraft({
        upiSales: String(c.upiSales),
        zomatoSales: String(c.zomatoSales),
        swiggySales: String(c.swiggySales),
        otherIncome: String(c.otherIncome),
      });
      setClosingCashDraft(c.closingCash !== null ? String(c.closingCash) : "");
      setOpeningCashDraft(String(c.openingCash));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Daily Closing.");
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    if (!canQuery) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canQuery, date]);

  if (loading) {
    return <main className="min-h-screen bg-[#fff8ed] px-4 py-10 text-slate-900">Checking your session…</main>;
  }
  if (!authenticated || role !== "admin") return null;

  const activeCategories = categories.filter((c) => c.active);

  // Subcategories available for a given category (only shown in the popup when non-empty).
  const subcategoriesFor = (categoryId: string): FinanceExpenseSubcategory[] =>
    subcategories.filter((s) => s.categoryId === categoryId && s.active);

  // Live preview numbers — mirrors services/financeClosingService.ts computeDerivedTotals().
  const previewClosingCash = closingCashDraft === "" ? null : Number(closingCashDraft);
  const previewOpeningCash = closing?.openingCashSource === "manual" ? Number(openingCashDraft) || 0 : closing?.openingCash ?? 0;
  const previewSales = {
    upi: Number(salesDraft.upiSales) || 0,
    zomato: Number(salesDraft.zomatoSales) || 0,
    swiggy: Number(salesDraft.swiggySales) || 0,
    other: Number(salesDraft.otherIncome) || 0,
  };
  const cashExpenseTotal = closing?.cashExpenseTotal ?? 0;
  const depositTotal = closing?.depositTotal ?? 0;
  const totalCashOut = closing?.totalCashOut ?? 0;
  const cashRevenue =
    previewClosingCash !== null ? roundCurrency(previewClosingCash - previewOpeningCash + cashExpenseTotal + depositTotal) : null;
  const totalRevenue = cashRevenue !== null ? roundCurrency(cashRevenue + previewSales.upi + previewSales.zomato + previewSales.swiggy + previewSales.other) : null;

  const handleSaveSales = async () => {
    if (!closing || closing.locked) return;
    try {
      const response = await firebaseAuthedFetch(`/api/finance/closing/${date}/sales`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          upiSales: Number(salesDraft.upiSales) || 0,
          zomatoSales: Number(salesDraft.zomatoSales) || 0,
          swiggySales: Number(salesDraft.swiggySales) || 0,
          otherIncome: Number(salesDraft.otherIncome) || 0,
        }),
      });
      const payload = await readJson(response);
      setClosing(payload.closing);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save sales.");
    }
  };

  const handleSaveOpeningCash = async () => {
    if (!closing || closing.locked || closing.openingCashSource !== "manual") return;
    try {
      const response = await firebaseAuthedFetch(`/api/finance/closing/${date}/opening-cash`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openingCash: Number(openingCashDraft) || 0 }),
      });
      const payload = await readJson(response);
      setClosing(payload.closing);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save opening cash.");
    }
  };

  const openExpenseModal = () => {
    setExpenseRows([{ key: `row-${Date.now()}`, categoryId: "", subcategoryId: "", amount: "", remarks: "" }]);
    setExpenseError("");
    setExpenseModalOpen(true);
  };

  const updateExpenseRow = (key: string, patch: Partial<ExpenseDraftRow>) => {
    setExpenseRows((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const addExpenseRow = () => {
    setExpenseRows((rows) => [...rows, { key: `row-${Date.now()}-${rows.length}`, categoryId: "", subcategoryId: "", amount: "", remarks: "" }]);
  };

  const removeExpenseRow = (key: string) => {
    setExpenseRows((rows) => (rows.length > 1 ? rows.filter((r) => r.key !== key) : rows));
  };

  const handleSaveExpenses = async () => {
    setExpenseError("");
    const valid = expenseRows
      .map((r) => ({ ...r, amountNum: Number(r.amount) }))
      .filter((r) => r.categoryId && Number.isFinite(r.amountNum) && r.amountNum > 0);
    if (valid.length === 0) {
      setExpenseError("Add at least one expense with a category and an amount greater than zero.");
      return;
    }
    // Guard against a row that has a subcategory selection but no parent category.
    const orphanSubcat = expenseRows.find((r) => r.subcategoryId && !r.categoryId);
    if (orphanSubcat) {
      setExpenseError("Pick a category before choosing a subcategory.");
      return;
    }
    setExpenseSaving(true);
    try {
      const response = await firebaseAuthedFetch(`/api/finance/closing/${date}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expenses: valid.map((r) => {
            const subs = subcategoriesFor(r.categoryId);
            const chosen = r.subcategoryId ? subs.find((s) => s.id === r.subcategoryId) : undefined;
            return {
              categoryId: r.categoryId,
              amount: r.amountNum,
              remarks: r.remarks,
              subcategoryId: chosen ? chosen.id : null,
              subcategoryName: chosen ? chosen.name : null,
            };
          }),
        }),
      });
      const payload = await readJson(response);
      setClosing(payload.closing);
      setExpenseModalOpen(false);
    } catch (err) {
      setExpenseError(err instanceof Error ? err.message : "Failed to save expenses.");
    } finally {
      setExpenseSaving(false);
    }
  };

  const handleRemoveExpense = async (entryId: string) => {
    if (!window.confirm("Remove this expense line?")) return;
    try {
      const response = await firebaseAuthedFetch(`/api/finance/closing/${date}/expenses/${entryId}`, { method: "DELETE" });
      const payload = await readJson(response);
      setClosing(payload.closing);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove expense.");
    }
  };

  const handleAddDeposit = async () => {
    setDepositError("");
    const amountNum = Number(depositForm.amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setDepositError("Enter a valid amount.");
      return;
    }
    setDepositSaving(true);
    try {
      const response = await firebaseAuthedFetch(`/api/finance/closing/${date}/deposits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: depositForm.type, amount: amountNum, remarks: depositForm.remarks }),
      });
      const payload = await readJson(response);
      setClosing(payload.closing);
      setDepositModalOpen(false);
      setDepositForm({ type: SUPPORTED_CASH_DEPOSIT_TYPES[0], amount: "", remarks: "" });
    } catch (err) {
      setDepositError(err instanceof Error ? err.message : "Failed to add deposit.");
    } finally {
      setDepositSaving(false);
    }
  };

  const handleRemoveDeposit = async (entryId: string) => {
    if (!window.confirm("Remove this deposit?")) return;
    try {
      const response = await firebaseAuthedFetch(`/api/finance/closing/${date}/deposits/${entryId}`, { method: "DELETE" });
      const payload = await readJson(response);
      setClosing(payload.closing);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove deposit.");
    }
  };

  const handleSaveDailyClosing = async () => {
    setError("");
    if (closingCashDraft === "" || Number.isNaN(Number(closingCashDraft))) {
      setError("Count the cash drawer and enter Closing Cash before saving.");
      return;
    }
    setSaving(true);
    try {
      // Make sure the latest sales figures are persisted before locking.
      await handleSaveSales();
      const response = await firebaseAuthedFetch(`/api/finance/closing/${date}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ closingCash: Number(closingCashDraft) }),
      });
      const payload = await readJson(response);
      setClosing(payload.closing);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save Daily Closing.");
    } finally {
      setSaving(false);
    }
  };

  const handleReopen = async () => {
    const reason = window.prompt("Reason for reopening this day?");
    if (!reason?.trim()) return;
    setSaving(true);
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
      setError(err instanceof Error ? err.message : "Failed to reopen the day.");
    } finally {
      setSaving(false);
    }
  };

  const locked = closing?.locked ?? false;
  const numericInputClass =
    "w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-50";

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-[#fff8ed] text-slate-900">
      {/* Fixed header */}
      <header className="flex-shrink-0 border-b border-orange-100 bg-white px-3 py-2.5 sm:px-6 sm:py-4">
        <div className="mx-auto flex max-w-2xl items-center gap-2 sm:gap-3">
          <Link
            href="/admin/finance"
            aria-label="Back to Finance"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 active:bg-slate-200 sm:h-10 sm:w-10"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-lg font-black leading-tight sm:text-2xl">Daily Closing</h1>
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value)}
            className="w-[8.5rem] flex-shrink-0 rounded-xl border border-slate-300 px-2 py-2 text-sm font-semibold text-slate-700 outline-none focus:border-orange-400 sm:w-auto sm:px-3 sm:py-2.5 sm:text-base"
          />
        </div>

        {locked ? (
          <div className="mx-auto mt-2 flex max-w-2xl items-center justify-between gap-2 rounded-xl bg-emerald-50 px-3 py-2">
            <p className="truncate text-xs font-semibold text-emerald-700">
              Closed at {closing?.closingTime} by {closing?.closedByName}
            </p>
            <button
              type="button"
              disabled={saving}
              onClick={handleReopen}
              className="flex-shrink-0 rounded-full px-2 py-1 text-xs font-semibold text-slate-500 underline hover:bg-emerald-100 hover:text-slate-800"
            >
              Reopen
            </button>
          </div>
        ) : null}

        <div className="mx-auto hidden max-w-2xl md:mt-4 md:block">
          <FinanceNav />
        </div>
      </header>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-2xl space-y-3 px-3 py-3 sm:space-y-4 sm:px-6 sm:py-5">
          {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p> : null}

          {closing?.postingWarnings && closing.postingWarnings.length > 0 ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <p className="font-semibold">Some amounts weren&apos;t posted to an account automatically:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {closing.postingWarnings.map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {fetching || !closing ? (
            <p className="py-10 text-center text-sm text-slate-500">Loading…</p>
          ) : (
            <>
              {/* Opening Cash */}
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">1. Opening Cash</p>
                {closing.openingCashSource === "chained" ? (
                  <>
                    <p className={`text-2xl font-black ${closing.openingCash < 0 ? "text-rose-600" : "text-slate-900"}`}>
                      {formatCurrency(closing.openingCash)} <span className="text-sm font-normal text-slate-400">(yesterday&apos;s closing cash)</span>
                    </p>
                    {closing.openingCash < 0 ? (
                      <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700">
                        ⚠ Opening with cash deficit: {formatCurrency(Math.abs(closing.openingCash))}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <div>
                    <p className="mb-2 text-xs text-slate-500">No previous closed day found — enter today&apos;s starting cash once.</p>
                    <input
                      type="number"
                      inputMode="decimal"
                      disabled={locked}
                      value={openingCashDraft}
                      onChange={(e) => setOpeningCashDraft(e.target.value)}
                      onBlur={handleSaveOpeningCash}
                      className="w-full max-w-xs rounded-2xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-50"
                    />
                    {Number(openingCashDraft) < 0 ? (
                      <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700">
                        ⚠ Opening with cash deficit: {formatCurrency(Math.abs(Number(openingCashDraft)))}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-slate-400">A negative value is fine — it means the drawer starts today already short. It will be carried forward in today&apos;s calculations.</p>
                  </div>
                )}
              </section>

              {/* Cash Expenses */}
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">2. Cash Expenses</p>
                  {!locked ? (
                    <button
                      type="button"
                      onClick={openExpenseModal}
                      className="flex flex-shrink-0 items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2.5 text-xs font-semibold text-white transition active:scale-[0.97] hover:bg-slate-800"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add Expenses
                    </button>
                  ) : null}
                </div>

                {closing.expenses.length === 0 ? (
                  <p className="py-4 text-center text-sm text-slate-400">No expenses added yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {closing.expenses.map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-2 rounded-2xl bg-slate-50 px-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-800">
                            {e.categoryName}
                            {e.subcategoryName ? <span className="font-normal text-slate-500"> · {e.subcategoryName}</span> : null}
                          </p>
                          {e.remarks ? <p className="truncate text-xs text-slate-400">{e.remarks}</p> : null}
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-1">
                          <p className="text-sm font-bold text-rose-600">{formatCurrency(e.amount)}</p>
                          {!locked ? (
                            <button
                              type="button"
                              onClick={() => handleRemoveExpense(e.id)}
                              className="rounded-full p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                              aria-label="Remove"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-4 border-t border-slate-100 pt-3">
                  <SummaryRow label="Cash Expense Total" value={formatCurrency(cashExpenseTotal)} emphasis />
                </div>
              </section>

              {/* Cash Deposits */}
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">3. Cash Deposits</p>
                    <p className="mt-0.5 text-xs text-slate-400">Cash moving out of the drawer — not a business expense.</p>
                  </div>
                  {!locked ? (
                    <button
                      type="button"
                      onClick={() => setDepositModalOpen(true)}
                      className="flex flex-shrink-0 items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2.5 text-xs font-semibold text-white transition active:scale-[0.97] hover:bg-slate-800"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add Deposit
                    </button>
                  ) : null}
                </div>

                {closing.deposits.length === 0 ? (
                  <p className="py-4 text-center text-sm text-slate-400">No deposits added yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {closing.deposits.map((d) => (
                      <li key={d.id} className="flex items-center justify-between gap-2 rounded-2xl bg-slate-50 px-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-800">{d.typeLabel}</p>
                          {d.remarks ? <p className="truncate text-xs text-slate-400">{d.remarks}</p> : null}
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-1">
                          <p className="text-sm font-bold text-sky-600">{formatCurrency(d.amount)}</p>
                          {!locked ? (
                            <button
                              type="button"
                              onClick={() => handleRemoveDeposit(d.id)}
                              className="rounded-full p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                              aria-label="Remove"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-4 space-y-1 border-t border-slate-100 pt-3">
                  <SummaryRow label="Cash Deposit Total" value={formatCurrency(depositTotal)} emphasis />
                  <SummaryRow label="Total Cash Out (Expenses + Deposits)" value={formatCurrency(totalCashOut)} muted />
                </div>
              </section>

              {/* Sales */}
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">4. Today&apos;s Sales</p>
                <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-500">UPI Sales</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      disabled={locked}
                      value={salesDraft.upiSales}
                      onChange={(e) => setSalesDraft((s) => ({ ...s, upiSales: e.target.value }))}
                      onBlur={handleSaveSales}
                      className={numericInputClass}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-500">Zomato Sales</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      disabled={locked}
                      value={salesDraft.zomatoSales}
                      onChange={(e) => setSalesDraft((s) => ({ ...s, zomatoSales: e.target.value }))}
                      onBlur={handleSaveSales}
                      className={numericInputClass}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-500">Swiggy Sales</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      disabled={locked}
                      value={salesDraft.swiggySales}
                      onChange={(e) => setSalesDraft((s) => ({ ...s, swiggySales: e.target.value }))}
                      onBlur={handleSaveSales}
                      className={numericInputClass}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-500">Other Income</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      disabled={locked}
                      value={salesDraft.otherIncome}
                      onChange={(e) => setSalesDraft((s) => ({ ...s, otherIncome: e.target.value }))}
                      onBlur={handleSaveSales}
                      className={numericInputClass}
                    />
                  </div>
                </div>
                <p className="mt-2 text-xs text-slate-400">No need to say which bank — that gets reconciled later.</p>
              </section>

              {/* Closing Cash */}
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">5. Count the Drawer</p>
                <label className="mb-1 block text-sm font-semibold text-slate-700">Closing Cash</label>
                <input
                  type="number"
                  inputMode="decimal"
                  disabled={locked}
                  value={closingCashDraft}
                  onChange={(e) => setClosingCashDraft(e.target.value)}
                  placeholder="Physical cash counted"
                  className="w-full max-w-xs rounded-2xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-50"
                />
              </section>

              {/* Daily Summary */}
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Daily Summary</p>
                <SummaryRow label="Opening Cash" value={formatCurrency(previewOpeningCash)} />
                <SummaryRow label="Cash Expenses" value={formatCurrency(cashExpenseTotal)} />
                <SummaryRow label="Cash Deposits" value={formatCurrency(depositTotal)} muted />
                <SummaryRow label="Total Cash Out" value={formatCurrency(totalCashOut)} />
                <SummaryRow label="Cash Revenue" value={cashRevenue !== null ? formatCurrency(cashRevenue) : "—"} emphasis />
                <SummaryRow label="UPI Sales" value={formatCurrency(previewSales.upi)} muted />
                <SummaryRow label="Zomato Sales" value={formatCurrency(previewSales.zomato)} muted />
                <SummaryRow label="Swiggy Sales" value={formatCurrency(previewSales.swiggy)} muted />
                <SummaryRow label="Other Income" value={formatCurrency(previewSales.other)} muted />
                <SummaryRow label="Total Revenue" value={totalRevenue !== null ? formatCurrency(totalRevenue) : "—"} emphasis />
                <SummaryRow label="Closing Cash" value={previewClosingCash !== null ? formatCurrency(previewClosingCash) : "—"} />
              </section>
            </>
          )}
        </div>
      </div>

      {/* Fixed bottom action bar */}
      {!fetching && closing ? (
        <footer
          className="flex-shrink-0 border-t border-slate-200 bg-white px-3 pt-3 shadow-[0_-6px_16px_-8px_rgba(15,23,42,0.15)] sm:px-6"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <div className="mx-auto max-w-2xl">
            {locked ? (
              <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-center text-sm font-semibold text-emerald-700">
                This day is closed and locked.
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400">Total Revenue</p>
                  <p className="truncate text-base font-black text-slate-900 sm:text-lg">{totalRevenue !== null ? formatCurrency(totalRevenue) : "—"}</p>
                </div>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSaveDailyClosing}
                  className="flex-shrink-0 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-bold text-white transition active:scale-[0.98] hover:bg-slate-800 disabled:opacity-50 sm:px-6 sm:py-3.5 sm:text-base"
                >
                  {saving ? "Saving…" : "Save Closing"}
                </button>
              </div>
            )}
          </div>
        </footer>
      ) : null}

      {expenseModalOpen ? (
        <Modal
          title="Add Cash Expenses"
          subtitle="Add as many lines as you need, then save them all at once."
          onClose={() => setExpenseModalOpen(false)}
          maxWidthClassName="max-w-3xl"
        >
          <div className="space-y-4">
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <div className="hidden grid-cols-[1.4fr_1.2fr_0.9fr_1.4fr_auto] gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 sm:grid">
                <span>Category</span>
                <span>Subcategory</span>
                <span>Amount</span>
                <span>Remarks</span>
                <span className="sr-only">Remove</span>
              </div>
              <div className="divide-y divide-slate-100">
                {expenseRows.map((row) => {
                  const subs = subcategoriesFor(row.categoryId);
                  return (
                    <div
                      key={row.key}
                      className="grid grid-cols-1 gap-2 px-3 py-3 sm:grid-cols-[1.4fr_1.2fr_0.9fr_1.4fr_auto] sm:items-center sm:gap-2"
                    >
                      <select
                        value={row.categoryId}
                        onChange={(e) => updateExpenseRow(row.key, { categoryId: e.target.value, subcategoryId: "" })}
                        className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                      >
                        <option value="">Category…</option>
                        {activeCategories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <select
                        value={row.subcategoryId}
                        disabled={!row.categoryId || subs.length === 0}
                        onChange={(e) => updateExpenseRow(row.key, { subcategoryId: e.target.value })}
                        className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-50 disabled:text-slate-300"
                      >
                        <option value="">{!row.categoryId ? "—" : subs.length === 0 ? "None" : "Subcategory…"}</option>
                        {subs.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={row.amount}
                        onChange={(e) => updateExpenseRow(row.key, { amount: e.target.value })}
                        placeholder="0"
                        className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                      />
                      <input
                        value={row.remarks}
                        onChange={(e) => updateExpenseRow(row.key, { remarks: e.target.value })}
                        placeholder="Remarks (optional)"
                        className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                      />
                      <button
                        type="button"
                        onClick={() => removeExpenseRow(row.key)}
                        disabled={expenseRows.length === 1}
                        className="flex items-center justify-center rounded-xl p-2.5 text-slate-400 hover:text-rose-600 disabled:opacity-30 sm:p-1.5"
                        aria-label="Remove row"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              onClick={addExpenseRow}
              className="flex items-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-3 py-2.5 text-xs font-semibold text-slate-600 transition hover:border-slate-400 hover:bg-slate-50"
            >
              <Plus className="h-3.5 w-3.5" /> Add another line
            </button>

            {expenseError ? <p className="text-sm font-medium text-rose-600">{expenseError}</p> : null}
            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setExpenseModalOpen(false)}
                className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:py-2.5"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={expenseSaving}
                onClick={handleSaveExpenses}
                className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 sm:py-2.5"
              >
                {expenseSaving ? "Saving…" : `Save ${expenseRows.filter((r) => r.categoryId && Number(r.amount) > 0).length || ""} Expense(s)`.trim()}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {depositModalOpen ? (
        <Modal title="Add Deposit" onClose={() => setDepositModalOpen(false)}>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">Deposit Type</label>
              <select
                value={depositForm.type}
                onChange={(e) => setDepositForm((f) => ({ ...f, type: e.target.value as CashDepositType }))}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              >
                {SUPPORTED_CASH_DEPOSIT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {CASH_DEPOSIT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">Amount</label>
              <input
                type="number"
                inputMode="decimal"
                value={depositForm.amount}
                onChange={(e) => setDepositForm((f) => ({ ...f, amount: e.target.value }))}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">Remarks (optional)</label>
              <input
                value={depositForm.remarks}
                onChange={(e) => setDepositForm((f) => ({ ...f, remarks: e.target.value }))}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              />
            </div>
            {depositError ? <p className="text-sm font-medium text-rose-600">{depositError}</p> : null}
            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setDepositModalOpen(false)}
                className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:py-2.5"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={depositSaving}
                onClick={handleAddDeposit}
                className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 sm:py-2.5"
              >
                {depositSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </main>
  );
}

export default function FinanceClosingPage() {
  return (
    <Suspense>
      <FinanceClosingContent />
    </Suspense>
  );
}
