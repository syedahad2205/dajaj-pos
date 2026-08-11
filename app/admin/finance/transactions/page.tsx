"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { requireFinanceAccess } from "@/lib/roleGuard";
import { firebaseAuthedFetch } from "@/lib/firebaseAuthFetch";
import { formatCurrency, todayDateKey } from "@/lib/financeFormat";
import FinanceNav from "@/components/finance/FinanceNav";
import NativeSelectField from "@/components/ui/NativeSelectField";
import NativeDateField from "@/components/ui/NativeDateField";

type TxType = "income" | "expense" | "transfer";

interface AccountOption {
  id: string;
  name: string;
  type: string;
  status: string;
}
interface CategoryOption {
  id: string;
  name: string;
  active: boolean;
}
interface SubcategoryOption {
  id: string;
  categoryId: string;
  name: string;
  active: boolean;
}

interface TransactionRow {
  id: string;
  type: TxType;
  date: string;
  categoryName: string | null;
  subcategoryName: string | null;
  amount: number;
  fromAccountName: string | null;
  toAccountName: string | null;
  remarks: string;
  status: "posted" | "void";
  autoPosted?: boolean;
}

async function readJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) throw new Error(payload?.message || "Request failed.");
  return payload;
}

function TypeBadge({ type }: { type: TxType }) {
  const styles: Record<TxType, string> = {
    income: "bg-emerald-100 text-emerald-700",
    expense: "bg-rose-100 text-rose-700",
    transfer: "bg-sky-100 text-sky-700",
  };
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${styles[type]}`}>{type}</span>;
}

function FinanceTransactionsContent() {
  const { authenticated, loading, role } = requireFinanceAccess();
  const hasFinanceAccess = authenticated && (role === "admin" || role === "financeManager");
  const canQuery = hasFinanceAccess;
  const searchParams = useSearchParams();

  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<CategoryOption[]>([]);
  const [incomeCategories, setIncomeCategories] = useState<CategoryOption[]>([]);
  const [refDataLoaded, setRefDataLoaded] = useState(false);
  const [subcategories, setSubcategories] = useState<SubcategoryOption[]>([]);
  const [subcategoriesLoading, setSubcategoriesLoading] = useState(false);

  const today = todayDateKey();
  const [entryType, setEntryType] = useState<TxType>("expense");
  const [entry, setEntry] = useState({
    categoryId: "",
    subcategoryId: "",
    fromAccountId: "",
    toAccountId: "",
    amount: "",
    remarks: "",
    date: today,
  });
  const [entrySaving, setEntrySaving] = useState(false);
  const [entryError, setEntryError] = useState("");
  const [entrySuccess, setEntrySuccess] = useState("");

  const [filters, setFilters] = useState({
    dateFrom: today,
    dateTo: today,
    type: "",
    accountId: searchParams?.get("accountId") ?? "",
    search: "",
    page: 1,
  });
  const [list, setList] = useState<{ transactions: TransactionRow[]; total: number; totalPages: number }>({
    transactions: [],
    total: 0,
    totalPages: 1,
  });
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [voidBusyId, setVoidBusyId] = useState<string | null>(null);

  const loadReferenceData = async () => {
    try {
      const [accountsRes, expenseCatRes, incomeCatRes] = await Promise.all([
        firebaseAuthedFetch("/api/finance/accounts"),
        firebaseAuthedFetch("/api/finance/expense-categories"),
        firebaseAuthedFetch("/api/finance/income-categories"),
      ]);
      const [accountsP, expenseCatP, incomeCatP] = await Promise.all([readJson(accountsRes), readJson(expenseCatRes), readJson(incomeCatRes)]);
      setAccounts(accountsP.accounts);
      setExpenseCategories(expenseCatP.categories);
      setIncomeCategories(incomeCatP.categories);
    } catch (err) {
      setEntryError(err instanceof Error ? err.message : "Failed to load accounts/categories.");
    } finally {
      setRefDataLoaded(true);
    }
  };

  const loadList = async () => {
    setListLoading(true);
    setListError("");
    try {
      const params = new URLSearchParams();
      params.set("dateFrom", filters.dateFrom);
      params.set("dateTo", filters.dateTo);
      if (filters.type) params.set("type", filters.type);
      if (filters.accountId) params.set("accountId", filters.accountId);
      if (filters.search) params.set("search", filters.search);
      params.set("page", String(filters.page));
      params.set("pageSize", "25");

      const response = await firebaseAuthedFetch(`/api/finance/transactions?${params.toString()}`);
      const payload = await readJson(response);
      setList({ transactions: payload.transactions, total: payload.total, totalPages: payload.totalPages });
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to load transactions.");
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    if (!canQuery) return;
    void loadReferenceData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canQuery]);

  useEffect(() => {
    if (!canQuery) return;
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canQuery, filters.dateFrom, filters.dateTo, filters.type, filters.accountId, filters.search, filters.page]);

  // Subcategories are expense-only (there's no income-subcategory concept in
  // this app) and scoped to whichever category is currently selected.
  useEffect(() => {
    if (entryType !== "expense" || !entry.categoryId) {
      setSubcategories([]);
      return;
    }
    let cancelled = false;
    setSubcategoriesLoading(true);
    firebaseAuthedFetch(`/api/finance/expense-subcategories?categoryId=${entry.categoryId}`)
      .then(readJson)
      .then((payload) => {
        if (!cancelled) setSubcategories(payload.subcategories);
      })
      .catch(() => {
        if (!cancelled) setSubcategories([]);
      })
      .finally(() => {
        if (!cancelled) setSubcategoriesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entryType, entry.categoryId]);

  const activeAccounts = useMemo(() => accounts.filter((a) => a.status === "active"), [accounts]);
  const activeExpenseCategories = useMemo(() => expenseCategories.filter((c) => c.active), [expenseCategories]);
  const activeIncomeCategories = useMemo(() => incomeCategories.filter((c) => c.active), [incomeCategories]);
  const activeSubcategories = useMemo(() => subcategories.filter((s) => s.active), [subcategories]);

  if (loading) {
    return <main className="min-h-screen bg-[#fff8ed] px-4 py-10 text-slate-900">Checking your session…</main>;
  }
  if (!hasFinanceAccess) return null;

  const resetEntry = (type: TxType) => {
    setEntryType(type);
    setEntry({ categoryId: "", subcategoryId: "", fromAccountId: "", toAccountId: "", amount: "", remarks: "", date: today });
    setSubcategories([]);
    setEntryError("");
    setEntrySuccess("");
  };

  const handleSubmitEntry = async () => {
    setEntryError("");
    setEntrySuccess("");

    const amountNum = Number(entry.amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setEntryError("Enter a valid amount.");
      return;
    }
    if (entryType === "income" && (!entry.categoryId || !entry.toAccountId)) {
      setEntryError("Category and Received Into account are required.");
      return;
    }
    if (entryType === "expense" && (!entry.categoryId || !entry.fromAccountId)) {
      setEntryError("Category and Paid From account are required.");
      return;
    }
    if (entryType === "transfer" && (!entry.fromAccountId || !entry.toAccountId)) {
      setEntryError("From and To accounts are required.");
      return;
    }
    if (entryType === "transfer" && entry.fromAccountId === entry.toAccountId) {
      setEntryError("From and To accounts must be different.");
      return;
    }

    setEntrySaving(true);

    // Optimistic row — only meaningful when today's entry falls inside the currently viewed window.
    const categoryName =
      entryType === "expense"
        ? expenseCategories.find((c) => c.id === entry.categoryId)?.name ?? null
        : entryType === "income"
        ? incomeCategories.find((c) => c.id === entry.categoryId)?.name ?? null
        : null;
    const subcategoryName = entryType === "expense" ? subcategories.find((s) => s.id === entry.subcategoryId)?.name ?? null : null;
    const fromAccountName = accounts.find((a) => a.id === entry.fromAccountId)?.name ?? null;
    const toAccountName = accounts.find((a) => a.id === entry.toAccountId)?.name ?? null;
    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticRow: TransactionRow = {
      id: optimisticId,
      type: entryType,
      date: entry.date,
      categoryName,
      subcategoryName,
      amount: amountNum,
      fromAccountName: entryType === "expense" || entryType === "transfer" ? fromAccountName : null,
      toAccountName: entryType === "income" || entryType === "transfer" ? toAccountName : null,
      remarks: entry.remarks,
      status: "posted",
    };
    const showOptimistically = filters.page === 1 && entry.date >= filters.dateFrom && entry.date <= filters.dateTo;
    if (showOptimistically) {
      setList((prev) => ({ ...prev, transactions: [optimisticRow, ...prev.transactions], total: prev.total + 1 }));
    }

    try {
      await readJson(
        await firebaseAuthedFetch("/api/finance/transactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: entryType,
            date: entry.date,
            categoryId: entryType !== "transfer" ? entry.categoryId : null,
            subcategoryId: entryType === "expense" ? entry.subcategoryId || null : null,
            amount: amountNum,
            fromAccountId: entryType !== "income" ? entry.fromAccountId : null,
            toAccountId: entryType !== "expense" ? entry.toAccountId : null,
            remarks: entry.remarks,
          }),
        }),
      );
      setEntrySuccess("Saved.");
      resetEntry(entryType);
      await Promise.all([loadList(), loadReferenceData()]);
    } catch (err) {
      if (showOptimistically) {
        setList((prev) => ({ ...prev, transactions: prev.transactions.filter((t) => t.id !== optimisticId), total: prev.total - 1 }));
      }
      setEntryError(err instanceof Error ? err.message : "Failed to save transaction.");
    } finally {
      setEntrySaving(false);
    }
  };

  const handleVoid = async (transaction: TransactionRow) => {
    const reason = window.prompt(`Reason for voiding this ${transaction.type} of ${formatCurrency(transaction.amount)}?`);
    if (!reason?.trim()) return;
    setVoidBusyId(transaction.id);
    try {
      await readJson(
        await firebaseAuthedFetch(`/api/finance/transactions/${transaction.id}/void`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        }),
      );
      await Promise.all([loadList(), loadReferenceData()]);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to void transaction.");
    } finally {
      setVoidBusyId(null);
    }
  };

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-orange-600">Finance</p>
          <h1 className="mt-1 text-3xl font-black">Transactions</h1>
          <p className="mt-2 text-sm text-slate-600">
            Bank payments, settlements, and transfers — anything that doesn&apos;t go through the cash drawer. Daily Closing
            stays untouched by this.
          </p>
          <div className="mt-5">
            <FinanceNav role={role} />
          </div>
        </header>

        {/* Quick entry */}
        <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">+ New Transaction</p>
          <div className="mb-4 flex flex-wrap gap-4">
            {(["expense", "income", "transfer"] as TxType[]).map((t) => (
              <label key={t} className="flex cursor-pointer items-center gap-2 text-sm font-semibold capitalize text-slate-700">
                <input type="radio" name="txType" checked={entryType === t} onChange={() => resetEntry(t)} className="h-4 w-4 accent-slate-900" />
                {t}
              </label>
            ))}
          </div>

          {!refDataLoaded ? (
            <p className="text-sm text-slate-500">Loading form…</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-500">Date</label>
                <NativeDateField value={entry.date} max={today} onChange={(e) => setEntry((f) => ({ ...f, date: e.target.value }))} />
              </div>

              {entryType !== "transfer" ? (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500">Category</label>
                  <NativeSelectField
                    value={entry.categoryId}
                    onChange={(e) => setEntry((f) => ({ ...f, categoryId: e.target.value, subcategoryId: "" }))}
                    displayValue={
                      (entryType === "expense" ? activeExpenseCategories : activeIncomeCategories).find((c) => c.id === entry.categoryId)?.name ??
                      "Select…"
                    }
                    placeholder={!entry.categoryId}
                  >
                    <option value="">Select…</option>
                    {(entryType === "expense" ? activeExpenseCategories : activeIncomeCategories).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </NativeSelectField>
                </div>
              ) : null}

              {entryType === "expense" && entry.categoryId && (subcategoriesLoading || activeSubcategories.length > 0) ? (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500">Subcategory (optional)</label>
                  <NativeSelectField
                    value={entry.subcategoryId}
                    disabled={subcategoriesLoading}
                    onChange={(e) => setEntry((f) => ({ ...f, subcategoryId: e.target.value }))}
                    displayValue={subcategoriesLoading ? "Loading…" : activeSubcategories.find((s) => s.id === entry.subcategoryId)?.name ?? "None"}
                    placeholder={!entry.subcategoryId}
                  >
                    <option value="">{subcategoriesLoading ? "Loading…" : "None"}</option>
                    {activeSubcategories.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </NativeSelectField>
                </div>
              ) : null}

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-500">Amount</label>
                <input
                  type="number"
                  value={entry.amount}
                  onChange={(e) => setEntry((f) => ({ ...f, amount: e.target.value }))}
                  placeholder="0"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                />
              </div>

              {entryType !== "income" ? (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500">{entryType === "expense" ? "Paid From" : "From Account"}</label>
                  <NativeSelectField
                    value={entry.fromAccountId}
                    onChange={(e) => setEntry((f) => ({ ...f, fromAccountId: e.target.value }))}
                    displayValue={activeAccounts.find((a) => a.id === entry.fromAccountId)?.name ?? "Select…"}
                    placeholder={!entry.fromAccountId}
                  >
                    <option value="">Select…</option>
                    {activeAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </NativeSelectField>
                </div>
              ) : null}

              {entryType !== "expense" ? (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500">{entryType === "income" ? "Received Into" : "To Account"}</label>
                  <NativeSelectField
                    value={entry.toAccountId}
                    onChange={(e) => setEntry((f) => ({ ...f, toAccountId: e.target.value }))}
                    displayValue={activeAccounts.find((a) => a.id === entry.toAccountId)?.name ?? "Select…"}
                    placeholder={!entry.toAccountId}
                  >
                    <option value="">Select…</option>
                    {activeAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </NativeSelectField>
                </div>
              ) : null}

              <div className="sm:col-span-2 lg:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-slate-500">Remarks (optional)</label>
                <input
                  value={entry.remarks}
                  onChange={(e) => setEntry((f) => ({ ...f, remarks: e.target.value }))}
                  placeholder="Optional"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                />
              </div>
            </div>
          )}

          {entryError ? <p className="mt-3 text-sm font-medium text-rose-600">{entryError}</p> : null}
          {entrySuccess ? <p className="mt-3 text-sm font-medium text-emerald-600">{entrySuccess}</p> : null}

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              disabled={entrySaving || !refDataLoaded}
              onClick={handleSubmitEntry}
              className="rounded-2xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {entrySaving ? "Saving…" : "Save"}
            </button>
          </div>
        </section>

        {/* Filters */}
        <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">From</label>
              <NativeDateField value={filters.dateFrom} onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value, page: 1 }))} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">To</label>
              <NativeDateField value={filters.dateTo} onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value, page: 1 }))} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">Type</label>
              <NativeSelectField
                value={filters.type}
                onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value, page: 1 }))}
                displayValue={filters.type ? filters.type[0].toUpperCase() + filters.type.slice(1) : "All"}
              >
                <option value="">All</option>
                <option value="income">Income</option>
                <option value="expense">Expense</option>
                <option value="transfer">Transfer</option>
              </NativeSelectField>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">Account</label>
              <NativeSelectField
                value={filters.accountId}
                onChange={(e) => setFilters((f) => ({ ...f, accountId: e.target.value, page: 1 }))}
                displayValue={accounts.find((a) => a.id === filters.accountId)?.name ?? "All"}
              >
                <option value="">All</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </NativeSelectField>
            </div>
          </div>
          <div className="mt-3">
            <input
              type="search"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value, page: 1 }))}
              placeholder="Search category or remarks…"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-400"
            />
          </div>
        </section>

        {/* Transaction list */}
        <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
          {listError ? <p className="p-4 text-sm font-medium text-rose-600">{listError}</p> : null}
          {listLoading ? (
            <p className="p-6 text-sm text-slate-500">Loading transactions…</p>
          ) : list.transactions.length === 0 ? (
            <p className="p-10 text-center text-sm font-semibold text-slate-400">No transactions for this filter.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Account</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3">Remarks</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {list.transactions.map((t) => (
                    <tr key={t.id} className={`border-b border-slate-50 ${t.status === "void" ? "opacity-50" : ""} ${t.id.startsWith("optimistic-") ? "animate-pulse" : ""}`}>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">{t.date}</td>
                      <td className="px-4 py-3">
                        <TypeBadge type={t.type} />
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {t.categoryName ?? "—"}
                        {t.subcategoryName ? <span className="text-slate-400"> · {t.subcategoryName}</span> : null}
                        {t.autoPosted ? (
                          <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400" title="Automatically posted from Daily Closing">
                            Auto
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {t.type === "transfer" ? `${t.fromAccountName ?? "—"} → ${t.toAccountName ?? "—"}` : t.fromAccountName ?? t.toAccountName ?? "—"}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-bold ${
                          t.type === "income" ? "text-emerald-600" : t.type === "expense" ? "text-rose-600" : "text-sky-600"
                        }`}
                      >
                        {formatCurrency(t.amount)}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{t.remarks || "—"}</td>
                      <td className="px-4 py-3 text-right">
                        {t.status === "posted" && !t.id.startsWith("optimistic-") ? (
                          <button
                            type="button"
                            disabled={voidBusyId === t.id}
                            onClick={() => handleVoid(t)}
                            className="text-xs font-semibold text-rose-600 hover:underline disabled:opacity-50"
                          >
                            Void
                          </button>
                        ) : t.status === "void" ? (
                          <span className="text-xs font-semibold text-slate-400">Voided</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
            <span>{list.total} transaction(s)</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={filters.page <= 1}
                onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
                className="rounded-xl border border-slate-300 px-3 py-1.5 font-semibold disabled:opacity-40"
              >
                Prev
              </button>
              <span>
                Page {filters.page} / {list.totalPages}
              </span>
              <button
                type="button"
                disabled={filters.page >= list.totalPages}
                onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
                className="rounded-xl border border-slate-300 px-3 py-1.5 font-semibold disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function FinanceTransactionsPage() {
  return (
    <Suspense>
      <FinanceTransactionsContent />
    </Suspense>
  );
}
