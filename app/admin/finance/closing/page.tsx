"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { requireAdmin } from "@/lib/roleGuard";
import { firebaseAuthedFetch } from "@/lib/firebaseAuthFetch";
import { formatCurrency, todayDateKey } from "@/lib/financeFormat";
import { roundCurrency, SUPPORTED_CASH_DEPOSIT_TYPES, CASH_DEPOSIT_TYPE_LABELS, type CashDepositType } from "@/lib/finance";
import FinanceNav from "@/components/finance/FinanceNav";
import Modal from "@/components/finance/Modal";

interface ExpenseEntry {
  id: string;
  categoryId: string;
  categoryName: string;
  amount: number;
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
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Local, instantly-reactive drafts so the summary card updates as the manager types,
  // without waiting on a round trip for every keystroke.
  const [salesDraft, setSalesDraft] = useState({ upiSales: "0", zomatoSales: "0", swiggySales: "0", otherIncome: "0" });
  const [closingCashDraft, setClosingCashDraft] = useState("");
  const [openingCashDraft, setOpeningCashDraft] = useState("0");

  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [expenseForm, setExpenseForm] = useState({ categoryId: "", amount: "", remarks: "" });
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
      const [closingRes, categoriesRes] = await Promise.all([
        firebaseAuthedFetch(`/api/finance/closing/${date}`),
        firebaseAuthedFetch("/api/finance/expense-categories"),
      ]);
      const [closingPayload, categoriesPayload] = await Promise.all([readJson(closingRes), readJson(categoriesRes)]);
      const c: DailyClosing = closingPayload.closing;
      setClosing(c);
      setCategories(categoriesPayload.categories);
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

  const handleAddExpense = async () => {
    setExpenseError("");
    const amountNum = Number(expenseForm.amount);
    if (!expenseForm.categoryId) {
      setExpenseError("Choose a category.");
      return;
    }
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setExpenseError("Enter a valid amount.");
      return;
    }
    setExpenseSaving(true);
    try {
      const response = await firebaseAuthedFetch(`/api/finance/closing/${date}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId: expenseForm.categoryId, amount: amountNum, remarks: expenseForm.remarks }),
      });
      const payload = await readJson(response);
      setClosing(payload.closing);
      setExpenseModalOpen(false);
      setExpenseForm({ categoryId: "", amount: "", remarks: "" });
    } catch (err) {
      setExpenseError(err instanceof Error ? err.message : "Failed to add expense.");
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

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-3xl space-y-5">
        <header className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-orange-600">Finance</p>
          <h1 className="mt-1 text-3xl font-black">Daily Closing</h1>
          <p className="mt-2 text-sm text-slate-600">
            Verify opening cash, log today&apos;s cash expenses and cash deposits, enter sales, count the drawer, and save.
            Under two minutes, no accounting knowledge required.
          </p>
          <div className="mt-5">
            <FinanceNav />
          </div>
        </header>

        <div className="flex items-center justify-between rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">Date</label>
            <input
              type="date"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-orange-400"
            />
          </div>
          {locked ? (
            <div className="text-right">
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                Closed at {closing?.closingTime} by {closing?.closedByName}
              </span>
              <button type="button" disabled={saving} onClick={handleReopen} className="mt-2 block text-xs font-semibold text-slate-500 underline hover:text-slate-800">
                Reopen (Admin)
              </button>
            </div>
          ) : null}
        </div>

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
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <>
            {/* Opening Cash */}
            <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
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
                    disabled={locked}
                    value={openingCashDraft}
                    onChange={(e) => setOpeningCashDraft(e.target.value)}
                    onBlur={handleSaveOpeningCash}
                    className="w-full max-w-xs rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-50"
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
            <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">2. Cash Expenses</p>
                {!locked ? (
                  <button
                    type="button"
                    onClick={() => setExpenseModalOpen(true)}
                    className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add Expense
                  </button>
                ) : null}
              </div>

              {closing.expenses.length === 0 ? (
                <p className="py-4 text-center text-sm text-slate-400">No expenses added yet.</p>
              ) : (
                <ul className="space-y-2">
                  {closing.expenses.map((e) => (
                    <li key={e.id} className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{e.categoryName}</p>
                        {e.remarks ? <p className="text-xs text-slate-400">{e.remarks}</p> : null}
                      </div>
                      <div className="flex items-center gap-4">
                        <p className="text-sm font-bold text-rose-600">{formatCurrency(e.amount)}</p>
                        {!locked ? (
                          <button type="button" onClick={() => handleRemoveExpense(e.id)} className="text-slate-400 hover:text-rose-600" aria-label="Remove">
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
            <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">3. Cash Deposits</p>
                  <p className="mt-0.5 text-xs text-slate-400">Cash moving out of the drawer — not a business expense.</p>
                </div>
                {!locked ? (
                  <button
                    type="button"
                    onClick={() => setDepositModalOpen(true)}
                    className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
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
                    <li key={d.id} className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{d.typeLabel}</p>
                        {d.remarks ? <p className="text-xs text-slate-400">{d.remarks}</p> : null}
                      </div>
                      <div className="flex items-center gap-4">
                        <p className="text-sm font-bold text-sky-600">{formatCurrency(d.amount)}</p>
                        {!locked ? (
                          <button type="button" onClick={() => handleRemoveDeposit(d.id)} className="text-slate-400 hover:text-rose-600" aria-label="Remove">
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
            <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">4. Today&apos;s Sales</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500">UPI Sales</label>
                  <input
                    type="number"
                    disabled={locked}
                    value={salesDraft.upiSales}
                    onChange={(e) => setSalesDraft((s) => ({ ...s, upiSales: e.target.value }))}
                    onBlur={handleSaveSales}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-orange-400 disabled:bg-slate-50"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500">Zomato Sales</label>
                  <input
                    type="number"
                    disabled={locked}
                    value={salesDraft.zomatoSales}
                    onChange={(e) => setSalesDraft((s) => ({ ...s, zomatoSales: e.target.value }))}
                    onBlur={handleSaveSales}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-orange-400 disabled:bg-slate-50"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500">Swiggy Sales</label>
                  <input
                    type="number"
                    disabled={locked}
                    value={salesDraft.swiggySales}
                    onChange={(e) => setSalesDraft((s) => ({ ...s, swiggySales: e.target.value }))}
                    onBlur={handleSaveSales}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-orange-400 disabled:bg-slate-50"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500">Other Income</label>
                  <input
                    type="number"
                    disabled={locked}
                    value={salesDraft.otherIncome}
                    onChange={(e) => setSalesDraft((s) => ({ ...s, otherIncome: e.target.value }))}
                    onBlur={handleSaveSales}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-orange-400 disabled:bg-slate-50"
                  />
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-400">No need to say which bank — that gets reconciled later.</p>
            </section>

            {/* Closing Cash */}
            <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">5. Count the Drawer</p>
              <label className="mb-1 block text-sm font-semibold text-slate-700">Closing Cash</label>
              <input
                type="number"
                disabled={locked}
                value={closingCashDraft}
                onChange={(e) => setClosingCashDraft(e.target.value)}
                placeholder="Physical cash counted"
                className="w-full max-w-xs rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-50"
              />
            </section>

            {/* Daily Summary */}
            <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
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

              {!locked ? (
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSaveDailyClosing}
                  className="mt-5 w-full rounded-2xl bg-slate-900 px-4 py-3.5 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save Daily Closing"}
                </button>
              ) : (
                <p className="mt-5 rounded-2xl bg-emerald-50 px-4 py-3 text-center text-sm font-semibold text-emerald-700">
                  This day is closed and locked.
                </p>
              )}
            </section>
          </>
        )}
      </div>

      {expenseModalOpen ? (
        <Modal title="Add Expense" onClose={() => setExpenseModalOpen(false)}>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">Category</label>
              <select
                value={expenseForm.categoryId}
                onChange={(e) => setExpenseForm((f) => ({ ...f, categoryId: e.target.value }))}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              >
                <option value="">Select…</option>
                {activeCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">Amount</label>
              <input
                type="number"
                value={expenseForm.amount}
                onChange={(e) => setExpenseForm((f) => ({ ...f, amount: e.target.value }))}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">Remarks (optional)</label>
              <input
                value={expenseForm.remarks}
                onChange={(e) => setExpenseForm((f) => ({ ...f, remarks: e.target.value }))}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              />
            </div>
            {expenseError ? <p className="text-sm font-medium text-rose-600">{expenseError}</p> : null}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setExpenseModalOpen(false)} className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button type="button" disabled={expenseSaving} onClick={handleAddExpense} className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
                {expenseSaving ? "Saving…" : "Save"}
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
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
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
                value={depositForm.amount}
                onChange={(e) => setDepositForm((f) => ({ ...f, amount: e.target.value }))}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">Remarks (optional)</label>
              <input
                value={depositForm.remarks}
                onChange={(e) => setDepositForm((f) => ({ ...f, remarks: e.target.value }))}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              />
            </div>
            {depositError ? <p className="text-sm font-medium text-rose-600">{depositError}</p> : null}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setDepositModalOpen(false)} className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button type="button" disabled={depositSaving} onClick={handleAddDeposit} className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
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
