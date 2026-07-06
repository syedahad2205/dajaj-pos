import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  type DocumentData,
  type DocumentSnapshot,
  type Firestore,
  type Transaction as FirestoreTransaction,
} from "firebase/firestore";
import { firestore as defaultFirestore } from "@/lib/firebase";
import {
  CASH_DEPOSIT_TYPE_LABELS,
  DEFAULT_BRANCH_ID,
  depositEventKey,
  generateLocalId,
  isValidDateKey,
  previousDateKey,
  roundCurrency,
  toTimeKey,
  type CashDepositType,
  type DailyClosingDepositEntry,
  type DailyClosingExpenseEntry,
  type FinanceDailyClosing,
  type FinanceDefault,
} from "@/lib/finance";
import { logFinanceAudit, writeFinanceAuditLog } from "@/services/financeAuditService";
import { getFinanceDefaultsMap } from "@/services/financeDefaultsService";
import { getOrCreateExpenseCategoryIdByName, getOrCreateIncomeCategoryIdByName } from "@/services/financeCategoriesService";
import { createFinanceTransaction, voidFinanceTransaction } from "@/services/financeTransactionsService";

// ─────────────────────────────────────────────────────────────────────────
// Daily Closing register — the restaurant's actual nightly workflow.
// Self-contained: expenses are embedded on the day's own document (no
// separate ledger join), sales are plain manually-entered totals. Opening
// Cash always chains from the previous LOCKED day's Closing Cash; the only
// exception is the very first day ever recorded, which allows one manual
// value. Every mutation function here reads-computes-writes the *entire*
// document inside a single Firestore transaction, so the stored totals can
// never drift from the expenses/sales that produced them.
// ─────────────────────────────────────────────────────────────────────────

function dailyClosingCollection(db: Firestore) {
  return collection(db, "fin_daily_closing");
}
function expenseCategoriesCollection(db: Firestore) {
  return collection(db, "fin_expense_categories");
}

function emptyClosing(date: string, branchId: string, openingCash: number, openingCashSource: "chained" | "manual"): FinanceDailyClosing {
  return {
    id: date,
    date,
    branchId,
    openingCash,
    openingCashSource,
    expenses: [],
    cashExpenseTotal: 0,
    deposits: [],
    depositTotal: 0,
    totalCashOut: 0,
    upiSales: 0,
    zomatoSales: 0,
    swiggySales: 0,
    otherIncome: 0,
    closingCash: null,
    cashRevenue: 0,
    totalRevenue: 0,
    locked: false,
    closingTime: null,
    closedBy: null,
    closedByName: null,
    reopenCount: 0,
    reopenedBy: null,
    reopenedByName: null,
    reopenReason: null,
    autoPostedTransactionsByEvent: {},
    postingWarnings: [],
  };
}

function computeDerivedTotals(input: {
  openingCash: number;
  expenses: DailyClosingExpenseEntry[];
  deposits: DailyClosingDepositEntry[];
  upiSales: number;
  zomatoSales: number;
  swiggySales: number;
  otherIncome: number;
  closingCash: number | null;
}) {
  const cashExpenseTotal = roundCurrency(input.expenses.reduce((sum, e) => sum + e.amount, 0));
  const depositTotal = roundCurrency(input.deposits.reduce((sum, d) => sum + d.amount, 0));
  const totalCashOut = roundCurrency(cashExpenseTotal + depositTotal);

  let cashRevenue = 0;
  let totalRevenue = 0;
  if (input.closingCash !== null) {
    cashRevenue = roundCurrency(input.closingCash - input.openingCash + cashExpenseTotal + depositTotal);
    totalRevenue = roundCurrency(cashRevenue + input.upiSales + input.zomatoSales + input.swiggySales + input.otherIncome);
  }

  return { cashExpenseTotal, depositTotal, totalCashOut, cashRevenue, totalRevenue };
}

/**
 * Backfills any Daily Closing document written before the Cash Deposits /
 * negative-Opening-Cash schema changes (e.g. missing `deposits`, docs that
 * still carry the old embedded `pigmiDeposit` on expense lines) so old rows
 * never crash the UI, and recomputes every derived total fresh so stored
 * numbers can't drift from source data. Every read of a raw Firestore doc
 * in this module should go through this — never trust `.data()` directly.
 */
function normalizeClosing(raw: DocumentData): FinanceDailyClosing {
  const expenses: DailyClosingExpenseEntry[] = Array.isArray(raw.expenses)
    ? raw.expenses.map((e: DocumentData) => ({
        id: e.id,
        categoryId: e.categoryId,
        categoryName: e.categoryName,
        amount: typeof e.amount === "number" ? e.amount : 0,
        remarks: e.remarks ?? "",
      }))
    : [];

  const deposits: DailyClosingDepositEntry[] = Array.isArray(raw.deposits)
    ? raw.deposits.map((d: DocumentData) => ({
        id: d.id,
        type: d.type as CashDepositType,
        typeLabel: d.typeLabel ?? CASH_DEPOSIT_TYPE_LABELS[d.type as CashDepositType] ?? String(d.type),
        amount: typeof d.amount === "number" ? d.amount : 0,
        remarks: d.remarks ?? "",
      }))
    : [];

  const openingCash = typeof raw.openingCash === "number" ? raw.openingCash : 0;
  const openingCashSource: "chained" | "manual" = raw.openingCashSource === "chained" ? "chained" : "manual";
  const upiSales = typeof raw.upiSales === "number" ? raw.upiSales : 0;
  const zomatoSales = typeof raw.zomatoSales === "number" ? raw.zomatoSales : 0;
  const swiggySales = typeof raw.swiggySales === "number" ? raw.swiggySales : 0;
  const otherIncome = typeof raw.otherIncome === "number" ? raw.otherIncome : 0;
  const closingCash = typeof raw.closingCash === "number" ? raw.closingCash : null;

  const totals = computeDerivedTotals({ openingCash, expenses, deposits, upiSales, zomatoSales, swiggySales, otherIncome, closingCash });

  return {
    id: raw.id ?? raw.date,
    date: raw.date,
    branchId: raw.branchId ?? DEFAULT_BRANCH_ID,
    openingCash,
    openingCashSource,
    expenses,
    deposits,
    upiSales,
    zomatoSales,
    swiggySales,
    otherIncome,
    closingCash,
    ...totals,
    locked: Boolean(raw.locked),
    closingTime: raw.closingTime ?? null,
    closedBy: raw.closedBy ?? null,
    closedByName: raw.closedByName ?? null,
    reopenCount: typeof raw.reopenCount === "number" ? raw.reopenCount : 0,
    reopenedBy: raw.reopenedBy ?? null,
    reopenedByName: raw.reopenedByName ?? null,
    reopenedAt: raw.reopenedAt ?? null,
    reopenReason: raw.reopenReason ?? null,
    // Back-compat: a doc written before this per-event map existed only had a
    // flat autoPostedTransactionIds array with no way to tell which event each
    // ID belonged to — treat those as "nothing tracked" rather than guess.
    autoPostedTransactionsByEvent:
      raw.autoPostedTransactionsByEvent && typeof raw.autoPostedTransactionsByEvent === "object" ? raw.autoPostedTransactionsByEvent : {},
    postingWarnings: Array.isArray(raw.postingWarnings) ? raw.postingWarnings : [],
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

/**
 * The single source of truth for what a day's Opening Cash should be RIGHT
 * NOW: always the previous day's CURRENT Closing Cash if that day is
 * locked — even overriding a value chained in earlier — so a later
 * correction to the previous day (via Reopen) flows forward automatically
 * the next time this day is touched, instead of leaving it stuck with a
 * stale Opening Cash forever. Falls back to `existingManualOpeningCash`
 * (whatever an admin already typed in for a day with no previous locked day
 * to chain from — e.g. the very first day ever) rather than resetting it to
 * 0 on every touch.
 */
function resolveOpeningCash(
  prevData: DocumentData | undefined,
  existingManualOpeningCash: number,
): { openingCash: number; openingCashSource: "chained" | "manual" } {
  if (prevData) {
    const prev = normalizeClosing(prevData);
    if (prev.locked && typeof prev.closingCash === "number") {
      return { openingCash: prev.closingCash, openingCashSource: "chained" };
    }
  }
  return { openingCash: existingManualOpeningCash, openingCashSource: "manual" };
}

/**
 * Shared entry point for every mutation inside a Firestore transaction
 * (add/remove an expense or deposit, update sales, set manual Opening
 * Cash): loads this day's existing not-yet-locked document if there is
 * one, or bootstraps an empty one — either way with Opening Cash freshly
 * resolved against the previous day's Closing Cash right now (see
 * resolveOpeningCash). Throws if the day is already locked (an admin must
 * Reopen it first) — a locked day's numbers never change silently; only an
 * explicit Reopen + re-save picks up a corrected previous day.
 */
async function loadOrBootstrapClosingInTx(
  tx: FirestoreTransaction,
  db: Firestore,
  date: string,
  branchId: string,
  closingSnap: DocumentSnapshot<DocumentData>,
): Promise<FinanceDailyClosing> {
  const prevSnap = await tx.get(doc(dailyClosingCollection(db), previousDateKey(date)));

  if (closingSnap.exists()) {
    const existing = normalizeClosing(closingSnap.data());
    assertNotLocked(existing, date);
    const existingManual = existing.openingCashSource === "manual" ? existing.openingCash : 0;
    const resolved = resolveOpeningCash(prevSnap.exists() ? prevSnap.data() : undefined, existingManual);
    const merged = { ...existing, openingCash: resolved.openingCash, openingCashSource: resolved.openingCashSource };
    return { ...merged, ...computeDerivedTotals(merged) };
  }

  const resolved = resolveOpeningCash(prevSnap.exists() ? prevSnap.data() : undefined, 0);
  return emptyClosing(date, branchId, resolved.openingCash, resolved.openingCashSource);
}

/**
 * Non-transactional counterpart of loadOrBootstrapClosingInTx — used by
 * read-only views and by closeDailyClosing, neither of which need (or can
 * cheaply get) a Firestore transaction here. Same self-healing behavior: a
 * not-yet-locked day always re-resolves Opening Cash against the previous
 * day's current Closing Cash rather than trusting whatever was stored the
 * last time this day was touched. A locked day is returned exactly as
 * stored — immutable until explicitly reopened.
 */
async function loadOrBootstrapClosing(date: string, db: Firestore, branchId: string): Promise<FinanceDailyClosing> {
  const [snap, prevSnap] = await Promise.all([
    getDoc(doc(dailyClosingCollection(db), date)),
    getDoc(doc(dailyClosingCollection(db), previousDateKey(date))),
  ]);

  if (snap.exists()) {
    const existing = normalizeClosing(snap.data());
    if (existing.locked) return existing;
    const existingManual = existing.openingCashSource === "manual" ? existing.openingCash : 0;
    const resolved = resolveOpeningCash(prevSnap.exists() ? prevSnap.data() : undefined, existingManual);
    const merged = { ...existing, openingCash: resolved.openingCash, openingCashSource: resolved.openingCashSource };
    return { ...merged, ...computeDerivedTotals(merged) };
  }

  const resolved = resolveOpeningCash(prevSnap.exists() ? prevSnap.data() : undefined, 0);
  return emptyClosing(date, branchId, resolved.openingCash, resolved.openingCashSource);
}

/**
 * Read-only view for the Daily Closing screen. If no document exists yet
 * for this date, returns a freshly-computed (not persisted) draft so the
 * screen has something to render before the manager adds anything —
 * viewing a date should never write to the database.
 */
export async function getDailyClosingView(
  date: string,
  db: Firestore = defaultFirestore,
  branchId: string = DEFAULT_BRANCH_ID,
): Promise<FinanceDailyClosing> {
  if (!isValidDateKey(date)) throw new Error("Invalid date.");
  return loadOrBootstrapClosing(date, db, branchId);
}

function assertNotLocked(existing: FinanceDailyClosing | null, date: string) {
  if (existing?.locked) {
    throw new Error(`${date} has been closed and locked. An admin must reopen it before it can be edited.`);
  }
}

export interface AddExpenseInput {
  categoryId: string;
  amount: number;
  remarks?: string;
}

/** Adds one pure cash-expense line to a day's register. Creates the day's document on first use. Cash Deposits (Pigmi etc.) are recorded separately via addDailyClosingDeposit. */
export async function addDailyClosingExpense(
  date: string,
  input: AddExpenseInput,
  userId: string,
  userName: string,
  db: Firestore = defaultFirestore,
  branchId: string = DEFAULT_BRANCH_ID,
): Promise<FinanceDailyClosing> {
  if (!isValidDateKey(date)) throw new Error("Invalid date.");
  if (!input.categoryId) throw new Error("Expense category is required.");
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("Amount must be a positive number.");

  return runTransaction(db, async (tx) => {
    const closingRef = doc(dailyClosingCollection(db), date);
    const categoryRef = doc(expenseCategoriesCollection(db), input.categoryId);

    const [closingSnap, categorySnap] = await Promise.all([tx.get(closingRef), tx.get(categoryRef)]);
    if (!categorySnap.exists()) throw new Error("Selected expense category no longer exists.");

    const base = await loadOrBootstrapClosingInTx(tx, db, date, branchId, closingSnap);

    const entry: DailyClosingExpenseEntry = {
      id: generateLocalId(),
      categoryId: input.categoryId,
      categoryName: categorySnap.data().name as string,
      amount: roundCurrency(input.amount),
      remarks: input.remarks?.trim() ?? "",
    };
    const expenses = [...base.expenses, entry];
    const totals = computeDerivedTotals({ ...base, expenses });
    const next: FinanceDailyClosing = { ...base, expenses, ...totals };

    tx.set(closingRef, { ...next, createdAt: closingSnap.exists() ? closingSnap.data().createdAt : serverTimestamp(), updatedAt: serverTimestamp() });
    tx.update(categoryRef, { transactionCount: ((categorySnap.data().transactionCount as number) ?? 0) + 1 });

    writeFinanceAuditLog(tx, db, {
      module: "closing_expense",
      entityId: entry.id,
      entityLabel: `${date} · ${entry.categoryName} · ₹${entry.amount}`,
      action: "create",
      userId,
      userName,
      newValue: entry,
    });

    return next;
  });
}

/** Removes one expense line from a day's (unlocked) register. */
export async function removeDailyClosingExpense(
  date: string,
  entryId: string,
  userId: string,
  userName: string,
  db: Firestore = defaultFirestore,
  branchId: string = DEFAULT_BRANCH_ID,
): Promise<FinanceDailyClosing> {
  return runTransaction(db, async (tx) => {
    const closingRef = doc(dailyClosingCollection(db), date);
    const closingSnap = await tx.get(closingRef);
    if (!closingSnap.exists()) throw new Error("No Daily Closing register found for this date.");
    const base = await loadOrBootstrapClosingInTx(tx, db, date, branchId, closingSnap);

    const entry = base.expenses.find((e) => e.id === entryId);
    if (!entry) throw new Error("Expense entry not found.");

    const categoryRef = doc(expenseCategoriesCollection(db), entry.categoryId);
    const categorySnap = await tx.get(categoryRef);

    const expenses = base.expenses.filter((e) => e.id !== entryId);
    const totals = computeDerivedTotals({ ...base, expenses });
    const next: FinanceDailyClosing = { ...base, expenses, ...totals };

    tx.set(closingRef, { ...next, updatedAt: serverTimestamp() });
    if (categorySnap.exists()) {
      tx.update(categoryRef, { transactionCount: Math.max(0, ((categorySnap.data().transactionCount as number) ?? 0) - 1) });
    }

    writeFinanceAuditLog(tx, db, {
      module: "closing_expense",
      entityId: entry.id,
      entityLabel: `${date} · ${entry.categoryName} · ₹${entry.amount}`,
      action: "delete",
      userId,
      userName,
      oldValue: entry,
    });

    return next;
  });
}

export interface AddDepositInput {
  type: CashDepositType;
  amount: number;
  remarks?: string;
}

/**
 * Adds one Cash Deposit line (Pigmi today; Bank/Petty Cash/Owner
 * Withdrawal/Returned to Safe later — same shape, no redesign needed).
 * Simpler than an expense: deposits aren't category-tagged, so there's no
 * second document to read/update.
 */
export async function addDailyClosingDeposit(
  date: string,
  input: AddDepositInput,
  userId: string,
  userName: string,
  db: Firestore = defaultFirestore,
  branchId: string = DEFAULT_BRANCH_ID,
): Promise<FinanceDailyClosing> {
  if (!isValidDateKey(date)) throw new Error("Invalid date.");
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("Amount must be a positive number.");
  const typeLabel = CASH_DEPOSIT_TYPE_LABELS[input.type];
  if (!typeLabel) throw new Error("Unknown deposit type.");

  return runTransaction(db, async (tx) => {
    const closingRef = doc(dailyClosingCollection(db), date);
    const closingSnap = await tx.get(closingRef);
    const base = await loadOrBootstrapClosingInTx(tx, db, date, branchId, closingSnap);

    const entry: DailyClosingDepositEntry = {
      id: generateLocalId(),
      type: input.type,
      typeLabel,
      amount: roundCurrency(input.amount),
      remarks: input.remarks?.trim() ?? "",
    };
    const deposits = [...base.deposits, entry];
    const totals = computeDerivedTotals({ ...base, deposits });
    const next: FinanceDailyClosing = { ...base, deposits, ...totals };

    tx.set(closingRef, { ...next, createdAt: closingSnap.exists() ? closingSnap.data().createdAt : serverTimestamp(), updatedAt: serverTimestamp() });

    writeFinanceAuditLog(tx, db, {
      module: "closing_deposit",
      entityId: entry.id,
      entityLabel: `${date} · ${entry.typeLabel} · ₹${entry.amount}`,
      action: "create",
      userId,
      userName,
      newValue: entry,
    });

    return next;
  });
}

/** Removes one Cash Deposit line from a day's (unlocked) register. */
export async function removeDailyClosingDeposit(
  date: string,
  entryId: string,
  userId: string,
  userName: string,
  db: Firestore = defaultFirestore,
  branchId: string = DEFAULT_BRANCH_ID,
): Promise<FinanceDailyClosing> {
  return runTransaction(db, async (tx) => {
    const closingRef = doc(dailyClosingCollection(db), date);
    const closingSnap = await tx.get(closingRef);
    if (!closingSnap.exists()) throw new Error("No Daily Closing register found for this date.");
    const base = await loadOrBootstrapClosingInTx(tx, db, date, branchId, closingSnap);

    const entry = base.deposits.find((d) => d.id === entryId);
    if (!entry) throw new Error("Deposit entry not found.");

    const deposits = base.deposits.filter((d) => d.id !== entryId);
    const totals = computeDerivedTotals({ ...base, deposits });
    const next: FinanceDailyClosing = { ...base, deposits, ...totals };

    tx.set(closingRef, { ...next, updatedAt: serverTimestamp() });

    writeFinanceAuditLog(tx, db, {
      module: "closing_deposit",
      entityId: entry.id,
      entityLabel: `${date} · ${entry.typeLabel} · ₹${entry.amount}`,
      action: "delete",
      userId,
      userName,
      oldValue: entry,
    });

    return next;
  });
}

export interface UpdateSalesInput {
  upiSales?: number;
  zomatoSales?: number;
  swiggySales?: number;
  otherIncome?: number;
}

/** Updates the day's manually-entered sales totals. No "which bank / which account" — those are recorded later at settlement. */
export async function updateDailyClosingSales(
  date: string,
  input: UpdateSalesInput,
  db: Firestore = defaultFirestore,
  branchId: string = DEFAULT_BRANCH_ID,
): Promise<FinanceDailyClosing> {
  return runTransaction(db, async (tx) => {
    const closingRef = doc(dailyClosingCollection(db), date);
    const closingSnap = await tx.get(closingRef);
    const base = await loadOrBootstrapClosingInTx(tx, db, date, branchId, closingSnap);

    const merged = {
      ...base,
      upiSales: input.upiSales !== undefined ? Math.max(0, roundCurrency(input.upiSales)) : base.upiSales,
      zomatoSales: input.zomatoSales !== undefined ? Math.max(0, roundCurrency(input.zomatoSales)) : base.zomatoSales,
      swiggySales: input.swiggySales !== undefined ? Math.max(0, roundCurrency(input.swiggySales)) : base.swiggySales,
      otherIncome: input.otherIncome !== undefined ? Math.max(0, roundCurrency(input.otherIncome)) : base.otherIncome,
    };
    const totals = computeDerivedTotals(merged);
    const next: FinanceDailyClosing = { ...merged, ...totals };

    tx.set(closingRef, { ...next, createdAt: closingSnap.exists() ? closingSnap.data().createdAt : serverTimestamp(), updatedAt: serverTimestamp() });
    return next;
  });
}

/** One-time manual Opening Cash entry — only allowed when there's no previous locked day to chain from. */
export async function setDailyClosingOpeningCash(
  date: string,
  openingCash: number,
  db: Firestore = defaultFirestore,
  branchId: string = DEFAULT_BRANCH_ID,
): Promise<FinanceDailyClosing> {
  // Opening Cash may legitimately be negative (the drawer started the day in deficit) — only reject non-numeric input.
  if (!Number.isFinite(openingCash)) throw new Error("Opening Cash must be a valid numeric value.");

  return runTransaction(db, async (tx) => {
    const closingRef = doc(dailyClosingCollection(db), date);
    const closingSnap = await tx.get(closingRef);
    const base = await loadOrBootstrapClosingInTx(tx, db, date, branchId, closingSnap);

    if (base.openingCashSource !== "manual") {
      throw new Error("Opening Cash is carried over from yesterday's Closing Cash and can't be edited directly here.");
    }

    const merged = { ...base, openingCash: roundCurrency(openingCash) };
    const totals = computeDerivedTotals(merged);
    const next: FinanceDailyClosing = { ...merged, ...totals };

    tx.set(closingRef, { ...next, createdAt: closingSnap.exists() ? closingSnap.data().createdAt : serverTimestamp(), updatedAt: serverTimestamp() });
    return next;
  });
}

/**
 * The full set of events this day's numbers *should* generate a ledger
 * posting for (amount > 0 only) — the shared source of truth for both
 * actually posting (postDailyClosingToLedger) and just checking "is
 * anything missing" (getMissingAutoPostEventKeys) without touching
 * Firestore. Keeping this in one place means the two can never drift.
 */
function getExpectedPostingEvents(
  closing: FinanceDailyClosing,
): Array<{ eventKey: string; eventName: string; amount: number; kind: "income" | "expense" | "deposit" }> {
  const incomeEvents = [
    { eventKey: "cash_sales", eventName: "Cash Sales", amount: closing.cashRevenue, kind: "income" as const },
    { eventKey: "upi_sales", eventName: "UPI Sales", amount: closing.upiSales, kind: "income" as const },
    // Revenue recognized today, not cash received today — these post to an
    // Escrow account (per Finance Defaults), not straight to a bank account.
    // The actual bank credit happens later via the platform's own settlement
    // reconciliation (see services/zomatoFinanceService.ts for Zomato).
    { eventKey: "zomato_sales", eventName: "Zomato Sales", amount: closing.zomatoSales, kind: "income" as const },
    { eventKey: "swiggy_sales", eventName: "Swiggy Sales", amount: closing.swiggySales, kind: "income" as const },
    { eventKey: "other_income", eventName: "Other Income", amount: closing.otherIncome, kind: "income" as const },
  ].filter((e) => e.amount > 0);

  // Cash Expenses: every rupee spent out of the physical cash drawer today.
  // Posted as a single Expense out of whatever account "Cash Sales" maps to
  // — the same implicit "cash drawer" account Cash Deposits already use —
  // so the Cash account's ledger balance reflects money actually leaving
  // the drawer, not just Cash Sales revenue piling up unopposed. No separate
  // Finance Defaults mapping needed: cash expenses always come out of the
  // same drawer Cash Sales revenue goes into.
  const expenseEvents = [{ eventKey: "cash_expenses", eventName: "Cash Expenses", amount: closing.cashExpenseTotal, kind: "expense" as const }].filter(
    (e) => e.amount > 0,
  );

  const depositTotalsByType = new Map<string, number>();
  for (const d of closing.deposits) {
    depositTotalsByType.set(d.type, roundCurrency((depositTotalsByType.get(d.type) ?? 0) + d.amount));
  }
  const depositEvents = Array.from(depositTotalsByType.entries())
    .filter(([, amount]) => amount > 0)
    .map(([type, amount]) => ({
      eventKey: depositEventKey(type as CashDepositType),
      eventName: `${CASH_DEPOSIT_TYPE_LABELS[type as CashDepositType] ?? type} Deposit`,
      amount,
      kind: "deposit" as const,
    }));

  return [...incomeEvents, ...expenseEvents, ...depositEvents];
}

/**
 * Which of this day's expected events (amount > 0) don't have a
 * corresponding entry in autoPostedTransactionsByEvent yet. This is the
 * authoritative "does this day need a backfill" check — NOT
 * `postingWarnings.length > 0`, which is empty both when everything
 * posted fine AND for any day closed before this auto-posting feature
 * existed at all (posting was never attempted, so nothing ever warned).
 */
export function getMissingAutoPostEventKeys(closing: FinanceDailyClosing): string[] {
  const postedKeys = new Set(Object.keys(closing.autoPostedTransactionsByEvent ?? {}));
  return getExpectedPostingEvents(closing)
    .filter((e) => !postedKeys.has(e.eventKey))
    .map((e) => e.eventKey);
}

/**
 * Posts the day's Income (Cash/UPI/Zomato/Swiggy/Other) and Cash Deposit
 * transfers to the fin_transactions ledger, per the Finance Defaults
 * mapping — the only place business rules about "which account does this
 * money go into" live. Never throws: a missing/inactive mapping just
 * skips that one posting and records a warning, so a manager closing the
 * books is never blocked by an admin configuration gap. Called with the
 * day's Finance Defaults still unlocked (see closeDailyClosing) since
 * createFinanceTransaction refuses to post to a locked day.
 *
 * `alreadyPostedEventKeys` lets a caller skip events that already posted
 * successfully — used by backfillDailyClosingPostings to retry only what's
 * missing instead of re-posting everything. closeDailyClosing itself
 * always passes an empty set (fresh full pass on every close/re-close).
 */
async function postDailyClosingToLedger(
  closing: FinanceDailyClosing,
  userId: string,
  userName: string,
  db: Firestore,
  branchId: string,
  alreadyPostedEventKeys: Set<string> = new Set(),
): Promise<{ transactionsByEvent: Record<string, string>; warnings: string[] }> {
  const transactionsByEvent: Record<string, string> = {};
  const warnings: string[] = [];
  const defaultsMap = await getFinanceDefaultsMap(db, branchId);
  const allEvents = getExpectedPostingEvents(closing);
  const incomeEvents = allEvents.filter((e) => e.kind === "income");
  const expenseEvents = allEvents.filter((e) => e.kind === "expense");
  const depositEvents = allEvents.filter((e) => e.kind === "deposit");

  // Cash Expenses and Cash Deposits both move money out of the same
  // implicit "cash drawer" account — whatever "Cash Sales" is configured
  // to land in. Resolved once up front so both loops below share it.
  const cashDrawerAccountId = defaultsMap.get("cash_sales")?.destinationAccountId ?? null;

  const resolveDestination = (eventKey: string, label: string, amount: number): FinanceDefault | null => {
    const mapping = defaultsMap.get(eventKey);
    if (!mapping || !mapping.isActive || !mapping.destinationAccountId) {
      warnings.push(
        `${label}: no active Finance Defaults mapping configured — ₹${amount} was not posted to an account. Configure it in Settings > Finance Defaults.`,
      );
      return null;
    }
    return mapping;
  };

  for (const event of incomeEvents) {
    if (alreadyPostedEventKeys.has(event.eventKey)) continue;
    if (!(event.amount > 0)) continue;
    const mapping = resolveDestination(event.eventKey, event.eventName, event.amount);
    if (!mapping || !mapping.destinationAccountId) continue;

    try {
      const categoryId = await getOrCreateIncomeCategoryIdByName(event.eventName, userId, userName, db, branchId);
      const tx = await createFinanceTransaction(
        {
          type: "income",
          date: closing.date,
          categoryId,
          amount: event.amount,
          toAccountId: mapping.destinationAccountId,
          remarks: "Auto-posted from Daily Closing",
          branchId,
          autoPosted: true,
          autoPostedSource: "daily_closing",
        },
        userId,
        userName,
        db,
      );
      transactionsByEvent[event.eventKey] = tx.id;
    } catch (err) {
      warnings.push(`${event.eventName}: failed to auto-post — ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  for (const event of expenseEvents) {
    if (alreadyPostedEventKeys.has(event.eventKey)) continue;
    if (!(event.amount > 0)) continue;

    if (!cashDrawerAccountId) {
      warnings.push(
        `${event.eventName}: can't determine the cash drawer account — configure "Cash Sales" in Settings > Finance Defaults first. ₹${event.amount} was not posted.`,
      );
      continue;
    }

    try {
      const categoryId = await getOrCreateExpenseCategoryIdByName("Daily Closing Cash Expenses", userId, userName, db, branchId);
      const tx = await createFinanceTransaction(
        {
          type: "expense",
          date: closing.date,
          categoryId,
          amount: event.amount,
          fromAccountId: cashDrawerAccountId,
          remarks: "Auto-posted from Daily Closing (cash expenses paid out of the drawer)",
          branchId,
          autoPosted: true,
          autoPostedSource: "daily_closing",
        },
        userId,
        userName,
        db,
      );
      transactionsByEvent[event.eventKey] = tx.id;
    } catch (err) {
      warnings.push(`${event.eventName}: failed to auto-post — ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  // Cash Deposits: one Transfer per deposit type present that day, out of
  // the same cash drawer account into the deposit type's own mapped account.
  for (const event of depositEvents) {
    if (alreadyPostedEventKeys.has(event.eventKey)) continue;
    const mapping = resolveDestination(event.eventKey, event.eventName, event.amount);
    if (!mapping || !mapping.destinationAccountId) continue;

    if (!cashDrawerAccountId) {
      warnings.push(
        `${event.eventName}: can't determine the cash drawer account — configure "Cash Sales" in Settings > Finance Defaults first. ₹${event.amount} was not posted.`,
      );
      continue;
    }

    try {
      const tx = await createFinanceTransaction(
        {
          type: "transfer",
          date: closing.date,
          amount: event.amount,
          fromAccountId: cashDrawerAccountId,
          toAccountId: mapping.destinationAccountId,
          remarks: `Auto-posted from Daily Closing (${event.eventName})`,
          branchId,
          autoPosted: true,
          autoPostedSource: "daily_closing",
        },
        userId,
        userName,
        db,
      );
      transactionsByEvent[event.eventKey] = tx.id;
    } catch (err) {
      warnings.push(`${event.eventName}: failed to auto-post — ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  return { transactionsByEvent, warnings };
}

/**
 * Locks the day. This is the single "Save Daily Closing" action: enter the
 * physically-counted Closing Cash and everything else (Cash Revenue, Total
 * Revenue) is derived — there's no separate "expected vs actual"
 * reconciliation step to fight with, unlike a traditional ledger close.
 *
 * Also the moment the day's numbers get posted to the fin_transactions
 * ledger per Finance Defaults (see postDailyClosingToLedger) — the
 * manager never sees or picks an account. If this is a re-close after an
 * admin reopened the day, the previous auto-postings are voided first so
 * corrections don't pile up as duplicates.
 *
 * Not wrapped in a single runTransaction: voiding old postings and
 * creating new ones each run through their own transactional service
 * calls against other collections, and Firestore transactions can't span
 * independent calls like that. Same accepted-risk trade-off as the rest of
 * this function for a single-manager, once-a-day action.
 */
export async function closeDailyClosing(
  date: string,
  closingCash: number,
  userId: string,
  userName: string,
  db: Firestore = defaultFirestore,
  branchId: string = DEFAULT_BRANCH_ID,
): Promise<FinanceDailyClosing> {
  if (!Number.isFinite(closingCash)) throw new Error("Closing Cash is required.");
  if (!isValidDateKey(date)) throw new Error("Invalid date.");

  const base = await loadOrBootstrapClosing(date, db, branchId);
  if (base.locked) throw new Error(`${date} is already closed. Ask an admin to reopen it first.`);

  const merged = { ...base, closingCash: roundCurrency(closingCash) };
  const totals = computeDerivedTotals(merged);
  const draft: FinanceDailyClosing = { ...merged, ...totals };

  const warnings: string[] = [];

  // Re-close after a reopen: void whatever was posted last time before posting fresh numbers.
  // If a void fails, the old transaction is still live and still affecting the
  // account balance — DON'T re-post that event too, or the amount gets counted
  // twice (once by the un-voided old transaction, once by the new one). Instead
  // leave that event's old transaction reference exactly as it was.
  const unvoidableEventKeys = new Set<string>();
  for (const [eventKey, txId] of Object.entries(draft.autoPostedTransactionsByEvent)) {
    try {
      await voidFinanceTransaction(txId, userId, userName, `Daily Closing for ${date} was re-saved`, db);
    } catch (err) {
      unvoidableEventKeys.add(eventKey);
      warnings.push(
        `Could not clean up a previous posting for this event (kept as-is to avoid double-counting): ${err instanceof Error ? err.message : "unknown error"}`,
      );
    }
  }

  const { transactionsByEvent, warnings: postingWarnings } = await postDailyClosingToLedger(
    draft,
    userId,
    userName,
    db,
    branchId,
    unvoidableEventKeys,
  );
  warnings.push(...postingWarnings);

  // Keep the old (un-voidable) transaction references alongside whatever posted fresh this round.
  const mergedAutoPosted: Record<string, string> = { ...transactionsByEvent };
  for (const eventKey of unvoidableEventKeys) {
    mergedAutoPosted[eventKey] = draft.autoPostedTransactionsByEvent[eventKey];
  }

  const closingRef = doc(dailyClosingCollection(db), date);
  const existingSnap = await getDoc(closingRef);
  const final: FinanceDailyClosing = {
    ...draft,
    locked: true,
    closingTime: toTimeKey(),
    closedBy: userId,
    closedByName: userName,
    autoPostedTransactionsByEvent: mergedAutoPosted,
    postingWarnings: warnings,
  };

  await setDoc(closingRef, {
    ...final,
    createdAt: existingSnap.exists() ? existingSnap.data()?.createdAt ?? serverTimestamp() : serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await logFinanceAudit({ module: "closing", entityId: date, entityLabel: date, action: "close", userId, userName, newValue: final }, db);

  return final;
}

/**
 * Retries only the events that failed to post last time (e.g. because
 * Finance Defaults wasn't configured yet when this day was closed) —
 * without a full reopen. Already-successful postings are left completely
 * untouched (no voiding, no duplicates). Use this after fixing a mapping
 * in Settings > Finance Defaults for days that are already locked.
 *
 * Briefly flips `locked` to false (createFinanceTransaction refuses to
 * post to a locked day) and back to true in a `finally`, so the day is
 * never left open even if posting throws partway through. This is
 * deliberately NOT the same as reopenDailyClosing — no reopenCount bump,
 * no reason prompt, closedBy/closingTime untouched — because nothing
 * about the day's own numbers changed, only what's in the ledger.
 */
export async function backfillDailyClosingPostings(
  date: string,
  userId: string,
  userName: string,
  db: Firestore = defaultFirestore,
  branchId: string = DEFAULT_BRANCH_ID,
): Promise<{ closing: FinanceDailyClosing; postedEventKeys: string[] }> {
  if (!isValidDateKey(date)) throw new Error("Invalid date.");

  const closingRef = doc(dailyClosingCollection(db), date);
  const snap = await getDoc(closingRef);
  if (!snap.exists()) throw new Error(`${date} has no Daily Closing record yet.`);
  const current = normalizeClosing(snap.data());
  if (!current.locked) throw new Error(`${date} isn't closed yet — just save Daily Closing normally.`);

  const alreadyPosted = new Set(Object.keys(current.autoPostedTransactionsByEvent));
  // Never trust postingWarnings alone here: it's empty both when everything
  // posted fine AND for a day closed before this auto-posting feature
  // existed at all, where nothing was ever attempted in the first place.
  if (getMissingAutoPostEventKeys(current).length === 0) {
    return { closing: current, postedEventKeys: [] };
  }

  await setDoc(closingRef, { locked: false, updatedAt: serverTimestamp() }, { merge: true });

  let finalClosing: FinanceDailyClosing = current;
  let postedEventKeys: string[] = [];
  try {
    const { transactionsByEvent, warnings } = await postDailyClosingToLedger(current, userId, userName, db, branchId, alreadyPosted);
    postedEventKeys = Object.keys(transactionsByEvent);
    finalClosing = {
      ...current,
      autoPostedTransactionsByEvent: { ...current.autoPostedTransactionsByEvent, ...transactionsByEvent },
      postingWarnings: warnings,
    };
  } finally {
    await setDoc(closingRef, { ...finalClosing, locked: true, updatedAt: serverTimestamp() });
  }

  if (postedEventKeys.length > 0) {
    await logFinanceAudit(
      {
        module: "closing",
        entityId: date,
        entityLabel: date,
        action: "backfill",
        userId,
        userName,
        newValue: { postedEventKeys, remainingWarnings: finalClosing.postingWarnings },
      },
      db,
    );
  }

  return { closing: finalClosing, postedEventKeys };
}

/** Admin-only: reopens a locked day so it can be edited again. Values are left in place (not wiped) so the day can just be tweaked and re-saved. */
export async function reopenDailyClosing(
  date: string,
  userId: string,
  userName: string,
  reason: string,
  db: Firestore = defaultFirestore,
): Promise<void> {
  if (!reason?.trim()) throw new Error("A reason is required to reopen a closed day.");

  const ref = doc(dailyClosingCollection(db), date);
  const snap = await getDoc(ref);
  if (!snap.exists() || !snap.data().locked) {
    throw new Error(`${date} is not currently locked.`);
  }
  const before = normalizeClosing(snap.data());

  await runTransaction(db, async (tx) => {
    const freshSnap = await tx.get(ref);
    if (!freshSnap.exists()) throw new Error(`${date} no longer exists.`);
    const fresh = normalizeClosing(freshSnap.data());
    tx.set(ref, {
      ...fresh,
      locked: false,
      reopenCount: (fresh.reopenCount ?? 0) + 1,
      reopenedBy: userId,
      reopenedByName: userName,
      reopenReason: reason.trim(),
      updatedAt: serverTimestamp(),
    });
  });

  await logFinanceAudit(
    {
      module: "closing",
      entityId: date,
      entityLabel: date,
      action: "reopen",
      userId,
      userName,
      oldValue: { locked: true, closingCash: before.closingCash },
      newValue: { locked: false },
      reason: reason.trim(),
    },
    db,
  );
}

export async function isDayLocked(date: string, db: Firestore = defaultFirestore): Promise<boolean> {
  const snap = await getDoc(doc(dailyClosingCollection(db), date));
  return snap.exists() && Boolean(snap.data().locked);
}

/** All Daily Closing records within an inclusive date range, sorted oldest-first — used by Reports, the Dashboard, and Pigmi tracking. */
export async function getDailyClosingsForRange(
  dateFrom: string,
  dateTo: string,
  db: Firestore = defaultFirestore,
  branchId: string = DEFAULT_BRANCH_ID,
): Promise<FinanceDailyClosing[]> {
  const snapshot = await getDocs(
    query(
      dailyClosingCollection(db),
      where("branchId", "==", branchId),
      where("date", ">=", dateFrom),
      where("date", "<=", dateTo),
      orderBy("date", "asc"),
    ),
  );
  return snapshot.docs.map((d) => normalizeClosing(d.data()));
}
