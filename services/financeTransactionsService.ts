import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  type Firestore,
  type Transaction as FirestoreTransaction,
} from "firebase/firestore";
import { firestore as defaultFirestore } from "@/lib/firebase";
import {
  DEFAULT_BRANCH_ID,
  roundCurrency,
  toDateKey,
  toTimeKey,
  type FinancePaymentMethod,
  type FinanceTransaction,
  type FinanceTransactionStatus,
  type FinanceTransactionType,
} from "@/lib/finance";
import { logFinanceAudit, writeFinanceAuditLog } from "@/services/financeAuditService";
import { getFinanceAccount } from "@/services/financeAccountsService";

function transactionsCollection(db: Firestore) {
  return collection(db, "fin_transactions");
}
function accountsCollection(db: Firestore) {
  return collection(db, "fin_accounts");
}
function expenseCategoriesCollection(db: Firestore) {
  return collection(db, "fin_expense_categories");
}
function expenseSubcategoriesCollection(db: Firestore) {
  return collection(db, "fin_expense_subcategories");
}
function incomeCategoriesCollection(db: Firestore) {
  return collection(db, "fin_income_categories");
}
function vendorsCollection(db: Firestore) {
  return collection(db, "fin_vendors");
}
// Note: Transactions are deliberately NOT gated by Daily Closing's lock
// state. They're independent ledgers by design (see the Transactions tab's
// own description: "Daily Closing stays untouched by this") — a manager
// should be able to record a bank payment or settlement for any date,
// closed or not, without needing an admin to reopen that day first.
// services/financeClosingService.ts still reads fin_daily_closing.locked
// for its OWN data (expenses/deposits/sales editing) — that's unrelated
// and unaffected by this.

export interface CreateFinanceTransactionInput {
  type: FinanceTransactionType;
  date?: string; // defaults to today
  time?: string; // defaults to now
  categoryId?: string | null;
  subcategoryId?: string | null;
  description?: string;
  amount: number;
  fromAccountId?: string | null;
  toAccountId?: string | null;
  vendorId?: string | null;
  paymentMethod?: FinancePaymentMethod | null;
  remarks?: string;
  referenceNumber?: string;
  branchId?: string;
  autoPosted?: boolean;
  autoPostedSource?: "daily_closing" | "zomato_settlement";
}

function validateInput(input: CreateFinanceTransactionInput) {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("Amount must be a positive number.");
  }
  if (input.type === "income") {
    if (!input.categoryId) throw new Error("Income category is required.");
    if (!input.toAccountId) throw new Error("Received-into account is required.");
  } else if (input.type === "expense") {
    if (!input.categoryId) throw new Error("Expense category is required.");
    if (!input.fromAccountId) throw new Error("Paid-from account is required.");
  } else if (input.type === "transfer") {
    if (!input.fromAccountId || !input.toAccountId) throw new Error("Both From and To accounts are required for a transfer.");
    if (input.fromAccountId === input.toAccountId) throw new Error("From and To accounts must be different.");
  } else {
    throw new Error("Unknown transaction type.");
  }
}

/**
 * Posts one ledger entry and atomically applies its effect on account
 * balances (and category/vendor rollups) inside a single Firestore
 * transaction. This is the only path by which money should ever move in
 * DAJAJ's books — nothing should bypass this function.
 */
export async function createFinanceTransaction(
  input: CreateFinanceTransactionInput,
  userId: string,
  userName: string,
  db: Firestore = defaultFirestore,
): Promise<FinanceTransaction> {
  validateInput(input);

  const now = new Date();
  const date = input.date ?? toDateKey(now);
  const time = input.time ?? toTimeKey(now);
  const branchId = input.branchId ?? DEFAULT_BRANCH_ID;
  const amount = roundCurrency(input.amount);
  const txRef = doc(transactionsCollection(db));

  const result = await runTransaction(db, async (tx) => {
    const fromAccountRef = input.fromAccountId ? doc(accountsCollection(db), input.fromAccountId) : null;
    const toAccountRef = input.toAccountId ? doc(accountsCollection(db), input.toAccountId) : null;
    const categoryRef =
      input.categoryId && input.type === "expense"
        ? doc(expenseCategoriesCollection(db), input.categoryId)
        : input.categoryId && input.type === "income"
        ? doc(incomeCategoriesCollection(db), input.categoryId)
        : null;
    const subcategoryRef =
      input.subcategoryId && input.type === "expense" ? doc(expenseSubcategoriesCollection(db), input.subcategoryId) : null;
    const vendorRef = input.vendorId && input.type === "expense" ? doc(vendorsCollection(db), input.vendorId) : null;

    const [fromAccountSnap, toAccountSnap, categorySnap, subcategorySnap, vendorSnap] = await Promise.all([
      fromAccountRef ? tx.get(fromAccountRef) : Promise.resolve(null),
      toAccountRef ? tx.get(toAccountRef) : Promise.resolve(null),
      categoryRef ? tx.get(categoryRef) : Promise.resolve(null),
      subcategoryRef ? tx.get(subcategoryRef) : Promise.resolve(null),
      vendorRef ? tx.get(vendorRef) : Promise.resolve(null),
    ]);

    if (fromAccountRef && (!fromAccountSnap?.exists() || fromAccountSnap.data()?.status !== "active")) {
      throw new Error("The 'From' / 'Paid from' account is invalid or archived.");
    }
    if (toAccountRef && (!toAccountSnap?.exists() || toAccountSnap.data()?.status !== "active")) {
      throw new Error("The 'To' / 'Received into' account is invalid or archived.");
    }
    if (categoryRef && !categorySnap?.exists()) {
      throw new Error("Selected category no longer exists.");
    }
    if (subcategoryRef && !subcategorySnap?.exists()) {
      throw new Error("Selected subcategory no longer exists.");
    }
    if (vendorRef && !vendorSnap?.exists()) {
      throw new Error("Selected vendor no longer exists.");
    }

    const categoryName = categorySnap?.exists() ? (categorySnap.data().name as string) : null;
    const subcategoryName = subcategorySnap?.exists() ? (subcategorySnap.data().name as string) : null;
    const vendorName = vendorSnap?.exists() ? (vendorSnap.data().name as string) : null;
    const fromAccountName = fromAccountSnap?.exists() ? (fromAccountSnap.data().name as string) : null;
    const toAccountName = toAccountSnap?.exists() ? (toAccountSnap.data().name as string) : null;

    const transactionData: Omit<FinanceTransaction, "id"> = {
      type: input.type,
      date,
      time,
      categoryId: input.categoryId ?? null,
      categoryName,
      subcategoryId: input.subcategoryId ?? null,
      subcategoryName,
      description: input.description?.trim() ?? "",
      amount,
      fromAccountId: input.fromAccountId ?? null,
      fromAccountName,
      toAccountId: input.toAccountId ?? null,
      toAccountName,
      vendorId: input.vendorId ?? null,
      vendorName,
      paymentMethod: input.paymentMethod ?? null,
      remarks: input.remarks?.trim() ?? "",
      referenceNumber: input.referenceNumber?.trim() ?? "",
      status: "posted",
      branchId,
      createdBy: userId,
      createdByName: userName,
      autoPosted: input.autoPosted ?? false,
      autoPostedSource: input.autoPostedSource ?? null,
      createdAt: serverTimestamp() as unknown as Timestamp,
      updatedAt: serverTimestamp() as unknown as Timestamp,
    };

    tx.set(txRef, transactionData);

    if (fromAccountRef && fromAccountSnap?.exists()) {
      tx.update(fromAccountRef, {
        currentBalance: roundCurrency((fromAccountSnap.data().currentBalance as number) - amount),
        updatedAt: serverTimestamp(),
      });
    }
    if (toAccountRef && toAccountSnap?.exists()) {
      tx.update(toAccountRef, {
        currentBalance: roundCurrency((toAccountSnap.data().currentBalance as number) + amount),
        updatedAt: serverTimestamp(),
      });
    }
    if (categoryRef && categorySnap?.exists()) {
      tx.update(categoryRef, { transactionCount: ((categorySnap.data().transactionCount as number) ?? 0) + 1 });
    }
    if (subcategoryRef && subcategorySnap?.exists()) {
      tx.update(subcategoryRef, { transactionCount: ((subcategorySnap.data().transactionCount as number) ?? 0) + 1 });
    }
    if (vendorRef && vendorSnap?.exists() && input.type === "expense") {
      tx.update(vendorRef, {
        totalPurchases: roundCurrency(((vendorSnap.data().totalPurchases as number) ?? 0) + amount),
        transactionCount: ((vendorSnap.data().transactionCount as number) ?? 0) + 1,
        updatedAt: serverTimestamp(),
      });
    }

    writeFinanceAuditLog(tx, db, {
      module: "transaction",
      entityId: txRef.id,
      entityLabel: describeTransactionForAudit(input.type, categoryName, fromAccountName, toAccountName, amount),
      action: "create",
      userId,
      userName,
      newValue: transactionData,
    });

    return { id: txRef.id, ...transactionData };
  });

  return result as FinanceTransaction;
}

function describeTransactionForAudit(
  type: FinanceTransactionType,
  categoryName: string | null,
  fromAccountName: string | null,
  toAccountName: string | null,
  amount: number,
) {
  if (type === "transfer") return `${fromAccountName} → ${toAccountName} · ₹${amount}`;
  if (type === "income") return `${categoryName} → ${toAccountName} · ₹${amount}`;
  return `${categoryName} ← ${fromAccountName} · ₹${amount}`;
}

/** Soft-reverses a posted transaction: flips its status to 'void' and undoes its balance/rollup effects atomically. The ledger row is never deleted. */
export async function voidFinanceTransaction(
  transactionId: string,
  userId: string,
  userName: string,
  reason: string,
  db: Firestore = defaultFirestore,
): Promise<void> {
  if (!reason?.trim()) throw new Error("A reason is required to void a transaction.");

  await runTransaction(db, async (tx) => {
    const txRef = doc(transactionsCollection(db), transactionId);
    const txSnap = await tx.get(txRef);
    if (!txSnap.exists()) throw new Error("Transaction not found.");
    const data = txSnap.data() as FinanceTransaction;
    if (data.status === "void") throw new Error("This transaction has already been voided.");

    const fromAccountRef = data.fromAccountId ? doc(accountsCollection(db), data.fromAccountId) : null;
    const toAccountRef = data.toAccountId ? doc(accountsCollection(db), data.toAccountId) : null;
    const categoryRef =
      data.categoryId && data.type === "expense"
        ? doc(expenseCategoriesCollection(db), data.categoryId)
        : data.categoryId && data.type === "income"
        ? doc(incomeCategoriesCollection(db), data.categoryId)
        : null;
    const subcategoryRef = data.subcategoryId ? doc(expenseSubcategoriesCollection(db), data.subcategoryId) : null;
    const vendorRef = data.vendorId ? doc(vendorsCollection(db), data.vendorId) : null;

    const [fromAccountSnap, toAccountSnap, categorySnap, subcategorySnap, vendorSnap] = await Promise.all([
      fromAccountRef ? tx.get(fromAccountRef) : Promise.resolve(null),
      toAccountRef ? tx.get(toAccountRef) : Promise.resolve(null),
      categoryRef ? tx.get(categoryRef) : Promise.resolve(null),
      subcategoryRef ? tx.get(subcategoryRef) : Promise.resolve(null),
      vendorRef ? tx.get(vendorRef) : Promise.resolve(null),
    ]);

    // Reverse the original balance effect (mirror image of createFinanceTransaction).
    if (fromAccountRef && fromAccountSnap?.exists()) {
      tx.update(fromAccountRef, {
        currentBalance: roundCurrency((fromAccountSnap.data().currentBalance as number) + data.amount),
        updatedAt: serverTimestamp(),
      });
    }
    if (toAccountRef && toAccountSnap?.exists()) {
      tx.update(toAccountRef, {
        currentBalance: roundCurrency((toAccountSnap.data().currentBalance as number) - data.amount),
        updatedAt: serverTimestamp(),
      });
    }
    if (categoryRef && categorySnap?.exists()) {
      tx.update(categoryRef, { transactionCount: Math.max(0, ((categorySnap.data().transactionCount as number) ?? 0) - 1) });
    }
    if (subcategoryRef && subcategorySnap?.exists()) {
      tx.update(subcategoryRef, {
        transactionCount: Math.max(0, ((subcategorySnap.data().transactionCount as number) ?? 0) - 1),
      });
    }
    if (vendorRef && vendorSnap?.exists() && data.type === "expense") {
      tx.update(vendorRef, {
        totalPurchases: roundCurrency(Math.max(0, ((vendorSnap.data().totalPurchases as number) ?? 0) - data.amount)),
        transactionCount: Math.max(0, ((vendorSnap.data().transactionCount as number) ?? 0) - 1),
        updatedAt: serverTimestamp(),
      });
    }

    tx.update(txRef, {
      status: "void" as FinanceTransactionStatus,
      voidedBy: userId,
      voidedByName: userName,
      voidedAt: serverTimestamp(),
      voidReason: reason.trim(),
      updatedAt: serverTimestamp(),
    });

    writeFinanceAuditLog(tx, db, {
      module: "transaction",
      entityId: transactionId,
      entityLabel: describeTransactionForAudit(data.type, data.categoryName, data.fromAccountName, data.toAccountName, data.amount),
      action: "void",
      userId,
      userName,
      oldValue: { status: data.status },
      newValue: { status: "void" },
      reason: reason.trim(),
    });
  });
}

export interface FinanceTransactionFilters {
  dateFrom: string;
  dateTo: string;
  type?: FinanceTransactionType;
  status?: FinanceTransactionStatus | "all";
  categoryId?: string;
  vendorId?: string;
  accountId?: string; // matches either fromAccountId or toAccountId
  createdBy?: string;
  amountMin?: number;
  amountMax?: number;
  search?: string; // matches description, vendorName, remarks, referenceNumber (case-insensitive substring)
  branchId?: string;
  page?: number; // 1-based
  pageSize?: number;
}

export interface FinanceTransactionPage {
  transactions: FinanceTransaction[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Lists ledger entries for a bounded date range, then applies the remaining
 * filters/search/pagination in memory. Firestore composite indexes only
 * cover (branchId, date) — see docs/finance-firestore-indexes.md — which
 * keeps every possible filter combination usable without needing a new
 * index per combination. This is a deliberate trade-off for a
 * single-restaurant transaction volume; if DAJAJ's ledger grows into the
 * tens of thousands of rows per month, the equality filters below should
 * move back into the Firestore query with dedicated composite indexes.
 */
export async function listFinanceTransactions(
  filters: FinanceTransactionFilters,
  db: Firestore = defaultFirestore,
): Promise<FinanceTransactionPage> {
  const branchId = filters.branchId ?? DEFAULT_BRANCH_ID;
  const page = filters.page && filters.page > 0 ? filters.page : 1;
  const pageSize = filters.pageSize && filters.pageSize > 0 ? filters.pageSize : 50;

  const snapshot = await getDocs(
    query(
      transactionsCollection(db),
      where("branchId", "==", branchId),
      where("date", ">=", filters.dateFrom),
      where("date", "<=", filters.dateTo),
      orderBy("date", "desc"),
    ),
  );

  let rows = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FinanceTransaction, "id">) }));

  if (!filters.status) {
    // Default view: hide voided entries so the ledger reads like a clean set of books.
    rows = rows.filter((r) => r.status !== "void");
  } else if (filters.status !== "all") {
    rows = rows.filter((r) => r.status === filters.status);
  }
  if (filters.type) rows = rows.filter((r) => r.type === filters.type);
  if (filters.categoryId) rows = rows.filter((r) => r.categoryId === filters.categoryId);
  if (filters.vendorId) rows = rows.filter((r) => r.vendorId === filters.vendorId);
  if (filters.accountId) rows = rows.filter((r) => r.fromAccountId === filters.accountId || r.toAccountId === filters.accountId);
  if (filters.createdBy) rows = rows.filter((r) => r.createdBy === filters.createdBy);
  if (typeof filters.amountMin === "number") rows = rows.filter((r) => r.amount >= filters.amountMin!);
  if (typeof filters.amountMax === "number") rows = rows.filter((r) => r.amount <= filters.amountMax!);
  if (filters.search?.trim()) {
    const needle = filters.search.trim().toLowerCase();
    rows = rows.filter((r) =>
      [r.description, r.vendorName, r.remarks, r.referenceNumber, r.categoryName, r.subcategoryName]
        .filter(Boolean)
        .some((field) => (field as string).toLowerCase().includes(needle)),
    );
  }

  // Sort newest first within a day by time, since the Firestore orderBy only covers `date`.
  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    if (a.time !== b.time) return a.time < b.time ? 1 : -1;
    return 0;
  });

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  return { transactions: pageRows, total, page, pageSize, totalPages };
}

export async function getFinanceTransaction(transactionId: string, db: Firestore = defaultFirestore): Promise<FinanceTransaction | null> {
  const snap = await getDoc(doc(transactionsCollection(db), transactionId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<FinanceTransaction, "id">) };
}

/** All posted (non-void) transactions for one date — used by dashboard + daily closing aggregation. */
export async function getPostedTransactionsForDate(
  date: string,
  db: Firestore = defaultFirestore,
  branchId: string = DEFAULT_BRANCH_ID,
): Promise<FinanceTransaction[]> {
  const snapshot = await getDocs(
    query(transactionsCollection(db), where("branchId", "==", branchId), where("date", "==", date)),
  );
  return snapshot.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<FinanceTransaction, "id">) }))
    .filter((t) => t.status === "posted");
}

/** All posted transactions within an inclusive date range — used by dashboard trends/reports. */
export async function getPostedTransactionsForRange(
  dateFrom: string,
  dateTo: string,
  db: Firestore = defaultFirestore,
  branchId: string = DEFAULT_BRANCH_ID,
): Promise<FinanceTransaction[]> {
  const snapshot = await getDocs(
    query(
      transactionsCollection(db),
      where("branchId", "==", branchId),
      where("date", ">=", dateFrom),
      where("date", "<=", dateTo),
    ),
  );
  return snapshot.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<FinanceTransaction, "id">) }))
    .filter((t) => t.status === "posted");
}

export interface AccountStatementRow {
  transactionId: string;
  date: string;
  time: string;
  type: FinanceTransactionType;
  label: string;
  remarks: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface AccountStatement {
  accountId: string;
  accountName: string;
  dateFrom: string;
  dateTo: string;
  openingBalance: number;
  closingBalance: number;
  totalDebits: number;
  totalCredits: number;
  rows: AccountStatementRow[];
}

/**
 * A bank-statement-style view of everything that ever hit one account:
 * date, what it was, debit/credit, and a running balance. Bounded the same
 * way as listFinanceTransactions — one Firestore query on (branchId, date)
 * covering all history up to dateTo, then filtered/summed in memory for
 * this specific account. Fine for a single restaurant's transaction volume;
 * see the note on listFinanceTransactions if that ever needs to change.
 */
export async function getAccountStatement(
  accountId: string,
  dateFrom: string,
  dateTo: string,
  db: Firestore = defaultFirestore,
  branchId: string = DEFAULT_BRANCH_ID,
): Promise<AccountStatement> {
  const account = await getFinanceAccount(accountId, db);
  if (!account) throw new Error("Account not found.");

  const allTransactions = await getPostedTransactionsForRange("2000-01-01", dateTo, db, branchId);
  const relevant = allTransactions
    .filter((t) => t.fromAccountId === accountId || t.toAccountId === accountId)
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.time !== b.time) return a.time < b.time ? -1 : 1;
      return 0;
    });

  const effectOnAccount = (t: FinanceTransaction): number => {
    let delta = 0;
    if (t.toAccountId === accountId) delta += t.amount;
    if (t.fromAccountId === accountId) delta -= t.amount;
    return delta;
  };

  const before = relevant.filter((t) => t.date < dateFrom);
  const within = relevant.filter((t) => t.date >= dateFrom && t.date <= dateTo);

  let runningBalance = roundCurrency(account.openingBalance + before.reduce((sum, t) => sum + effectOnAccount(t), 0));
  const openingBalance = runningBalance;

  let totalDebits = 0;
  let totalCredits = 0;
  const rows: AccountStatementRow[] = within.map((t) => {
    const debit = t.fromAccountId === accountId ? t.amount : 0;
    const credit = t.toAccountId === accountId ? t.amount : 0;
    totalDebits = roundCurrency(totalDebits + debit);
    totalCredits = roundCurrency(totalCredits + credit);
    runningBalance = roundCurrency(runningBalance + effectOnAccount(t));

    const label =
      t.type === "transfer"
        ? t.fromAccountId === accountId
          ? `Transfer to ${t.toAccountName ?? "—"}`
          : `Transfer from ${t.fromAccountName ?? "—"}`
        : t.categoryName ?? (t.type === "income" ? "Income" : "Expense");

    return {
      transactionId: t.id,
      date: t.date,
      time: t.time,
      type: t.type,
      label,
      remarks: t.remarks,
      debit,
      credit,
      runningBalance,
    };
  });

  return {
    accountId: account.id,
    accountName: account.name,
    dateFrom,
    dateTo,
    openingBalance,
    closingBalance: runningBalance,
    totalDebits,
    totalCredits,
    rows,
  };
}

export interface AccountBalanceReconciliation {
  accountId: string;
  accountName: string;
  storedBalance: number;
  computedBalance: number;
  drift: number;
  corrected: boolean;
}

/**
 * Compares an account's stored `currentBalance` against what it should be
 * if recomputed from scratch (openingBalance + every posted transaction's
 * effect on this account, ever) — the same math getAccountStatement uses
 * for its closing balance. A nonzero drift means currentBalance fell out
 * of sync with the ledger somewhere (e.g. a void that failed partway
 * through a Daily Closing re-close, or an old bug already fixed since).
 *
 * With `apply: true`, corrects currentBalance to the computed value and
 * logs the correction (module "account", action "update") with the old/new
 * values and drift amount in the reason, so it's visible in the audit
 * trail as a reconciliation rather than a normal edit.
 */
export async function reconcileAccountBalance(
  accountId: string,
  userId: string,
  userName: string,
  apply: boolean,
  db: Firestore = defaultFirestore,
  branchId: string = DEFAULT_BRANCH_ID,
): Promise<AccountBalanceReconciliation> {
  const account = await getFinanceAccount(accountId, db);
  if (!account) throw new Error("Account not found.");

  const today = toDateKey();
  const allTransactions = await getPostedTransactionsForRange("2000-01-01", today, db, branchId);
  const computedBalance = roundCurrency(
    account.openingBalance +
      allTransactions.reduce((sum, t) => {
        if (t.toAccountId === accountId) return sum + t.amount;
        if (t.fromAccountId === accountId) return sum - t.amount;
        return sum;
      }, 0),
  );

  const drift = roundCurrency(computedBalance - account.currentBalance);
  let corrected = false;

  if (apply && drift !== 0) {
    await updateDoc(doc(accountsCollection(db), accountId), { currentBalance: computedBalance, updatedAt: serverTimestamp() });
    await logFinanceAudit(
      {
        module: "account",
        entityId: accountId,
        entityLabel: account.name,
        action: "update",
        userId,
        userName,
        oldValue: { currentBalance: account.currentBalance },
        newValue: { currentBalance: computedBalance },
        reason: `Balance reconciliation: recomputed from the ledger (drift was ${drift >= 0 ? "+" : ""}₹${drift})`,
      },
      db,
    );
    corrected = true;
  }

  return {
    accountId: account.id,
    accountName: account.name,
    storedBalance: account.currentBalance,
    computedBalance,
    drift,
    corrected,
  };
}
