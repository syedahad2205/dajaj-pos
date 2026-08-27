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
  nextDateKey,
  previousDateKey,
  roundCurrency,
  toDateKey,
  toTimeKey,
  type CashDepositType,
  type DailyClosingDepositEntry,
  type DailyClosingExpenseEntry,
  type FinanceDailyClosing,
  type FinanceDefault,
  type FinanceTransaction,
} from "@/lib/finance";
import { logFinanceAudit, writeFinanceAuditLog } from "@/services/financeAuditService";
import { getFinanceDefaultsMap } from "@/services/financeDefaultsService";
import { getOrCreateExpenseCategoryIdByName, getOrCreateIncomeCategoryIdByName } from "@/services/financeCategoriesService";
import { createFinanceTransaction, getPostedTransactionsForRange, voidFinanceTransaction } from "@/services/financeTransactionsService";
import { getFinanceAccount } from "@/services/financeAccountsService";

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
function expenseSubcategoriesCollection(db: Firestore) {
  return collection(db, "fin_expense_subcategories");
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
    externalCashAdjustment: 0,
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
        subcategoryId: e.subcategoryId ?? null,
        subcategoryName: e.subcategoryName ?? null,
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
  // 0 for any day this hasn't been computed for yet (legacy docs, or a day
  // that hasn't been through closeDailyClosing/the history resync since
  // this field was introduced) — resolveOpeningCash treats that as "no
  // external transfers known for that day", same as before this existed.
  const externalCashAdjustment = typeof raw.externalCashAdjustment === "number" ? raw.externalCashAdjustment : 0;

  const totals = computeDerivedTotals({ openingCash, expenses, deposits, upiSales, zomatoSales, swiggySales, otherIncome, closingCash });

  return {
    id: raw.id ?? raw.date,
    date: raw.date,
    branchId: raw.branchId ?? DEFAULT_BRANCH_ID,
    openingCash,
    openingCashSource,
    externalCashAdjustment,
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
 *
 * This is the RULE, with exactly one explicit exception layered on top by
 * the caller afterward (see applySameDayExternalAdjustment below) — this
 * function itself never deviates from "previous day's Closing Cash".
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
 * The one explicit EXCEPTION to "Opening Cash is always the previous
 * day's Closing Cash": if money was manually moved into/out of the
 * drawer on THIS SAME day via a Transfer on the Transactions tab (e.g.
 * "Transfer from ICICI") — a real, recorded change to the drawer that
 * Daily Closing's own expense/deposit tracking never sees — that amount
 * is folded into THIS day's own Opening Cash before Cash Revenue is
 * computed, so it's correctly absorbed there instead of showing up as a
 * Cash Recount Adjustment that would otherwise (wrongly) cancel it back
 * out at the end of the same day. A day with no such transfer passes
 * through unchanged — the rule (previous day's Closing Cash) holds exactly.
 */
function applySameDayExternalAdjustment(chainedOpeningCash: number, externalCashAdjustment: number): number {
  return roundCurrency(chainedOpeningCash + externalCashAdjustment);
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
  prefetchedPrevSnap?: DocumentSnapshot<DocumentData>,
): Promise<FinanceDailyClosing> {
  // Callers that already know they need yesterday's doc can fetch it in the
  // same Promise.all as their other reads and pass it in here, saving a
  // sequential round trip. Falls back to fetching it itself otherwise.
  const prevSnap = prefetchedPrevSnap ?? (await tx.get(doc(dailyClosingCollection(db), previousDateKey(date))));

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
  subcategoryId?: string | null;
  subcategoryName?: string | null;
}

/**
 * Validates + resolves a single expense line's subcategory (if any). Throws
 * if a subcategory is supplied that doesn't exist or doesn't belong to the
 * chosen category. Pass `allowNone` to also accept a row that has no
 * subcategory selected (used by the batch add where only some rows are
 * subcategory-tagged).
 */
async function resolveExpenseSubcategory(
  tx: FirestoreTransaction,
  db: Firestore,
  categoryId: string,
  categoryName: string,
  subcategoryId?: string | null,
): Promise<{ subcategoryId: string | null; subcategoryName: string | null }> {
  if (!subcategoryId) return { subcategoryId: null, subcategoryName: null };
  const subSnap = await tx.get(doc(expenseSubcategoriesCollection(db), subcategoryId));
  if (!subSnap.exists()) throw new Error(`Selected subcategory for "${categoryName}" no longer exists.`);
  const subData = subSnap.data();
  if (subData.categoryId !== categoryId) {
    throw new Error(`"${subData.name}" is not a subcategory of "${categoryName}".`);
  }
  return { subcategoryId: subSnap.id, subcategoryName: subData.name as string };
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

    const { subcategoryId, subcategoryName } = await resolveExpenseSubcategory(
      tx,
      db,
      input.categoryId,
      categorySnap.data().name as string,
      input.subcategoryId ?? null,
    );

    const entry: DailyClosingExpenseEntry = {
      id: generateLocalId(),
      categoryId: input.categoryId,
      categoryName: categorySnap.data().name as string,
      subcategoryId,
      subcategoryName,
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
      entityLabel: `${date} · ${entry.categoryName}${entry.subcategoryName ? ` · ${entry.subcategoryName}` : ""} · ₹${entry.amount}`,
      action: "create",
      userId,
      userName,
      newValue: entry,
    });

    return next;
  });
}

/**
 * Adds many cash-expense lines to a day's register in a single transaction —
 * used by the bulk "add several expenses at once" popup so the user only
 * waits on one round trip instead of one per line. Mirrors
 * addDailyClosingExpense per line (subcategory resolution, category
 * transactionCount bumps, audit logging) but does it for every entry at
 * once. Empty/invalid rows are skipped rather than failing the whole batch,
 * except for hard data errors (bad category, subcategory mismatch) which
 * abort the whole save so nothing partial is written.
 */
export async function addDailyClosingExpenses(
  date: string,
  inputs: AddExpenseInput[],
  userId: string,
  userName: string,
  db: Firestore = defaultFirestore,
  branchId: string = DEFAULT_BRANCH_ID,
): Promise<FinanceDailyClosing> {
  if (!isValidDateKey(date)) throw new Error("Invalid date.");
  const valid = (inputs ?? []).filter(
    (i) => i && i.categoryId && Number.isFinite(i.amount) && (i.amount as number) > 0,
  );
  if (valid.length === 0) throw new Error("Add at least one expense with a category and a positive amount.");

  return runTransaction(db, async (tx) => {
    const closingRef = doc(dailyClosingCollection(db), date);

    // ALL READS UP FRONT, IN ONE PARALLEL BATCH — Firestore transactions
    // require every read to finish before any write begins, and each tx.get()
    // is its own network round trip. This used to be 3 *sequential* round
    // trips (this day's doc, then categories/subcategories, then yesterday's
    // doc for the opening-cash chain) — firing them all together cuts that
    // down to 1, which is most of the win on the save-latency front.
    const categoryIds = Array.from(new Set(valid.map((i) => i.categoryId)));
    const subIds = Array.from(new Set(valid.map((i) => i.subcategoryId).filter((s): s is string => !!s)));

    const [closingSnap, prevSnap, categorySnaps, subSnaps] = await Promise.all([
      tx.get(closingRef),
      tx.get(doc(dailyClosingCollection(db), previousDateKey(date))),
      Promise.all(categoryIds.map((id) => tx.get(doc(expenseCategoriesCollection(db), id)))),
      Promise.all(subIds.map((id) => tx.get(doc(expenseSubcategoriesCollection(db), id)))),
    ]);
    const categoryById = new Map(categorySnaps.map((s) => [s.id, s]));
    const subById = new Map(subSnaps.map((s) => [s.id, s]));

    const base = await loadOrBootstrapClosingInTx(tx, db, date, branchId, closingSnap, prevSnap);

    const categoryCountBumps = new Map<string, number>();
    const newEntries: DailyClosingExpenseEntry[] = [];

    for (const input of valid) {
      const categorySnap = categoryById.get(input.categoryId);
      if (!categorySnap || !categorySnap.exists()) throw new Error(`Expense category "${input.categoryId}" no longer exists.`);
      const categoryName = categorySnap.data().name as string;

      let subcategoryId: string | null = null;
      let subcategoryName: string | null = null;
      if (input.subcategoryId) {
        const subSnap = subById.get(input.subcategoryId);
        if (!subSnap || !subSnap.exists()) throw new Error(`Selected subcategory for "${categoryName}" no longer exists.`);
        const subData = subSnap.data();
        if (subData.categoryId !== input.categoryId) {
          throw new Error(`"${subData.name}" is not a subcategory of "${categoryName}".`);
        }
        subcategoryId = subSnap.id;
        subcategoryName = subData.name as string;
      }

      const entry: DailyClosingExpenseEntry = {
        id: generateLocalId(),
        categoryId: input.categoryId,
        categoryName,
        subcategoryId,
        subcategoryName,
        amount: roundCurrency(input.amount),
        remarks: input.remarks?.trim() ?? "",
      };
      newEntries.push(entry);
      categoryCountBumps.set(input.categoryId, (categoryCountBumps.get(input.categoryId) ?? 0) + 1);
    }

    const expenses = [...base.expenses, ...newEntries];
    const totals = computeDerivedTotals({ ...base, expenses });
    const next: FinanceDailyClosing = { ...base, expenses, ...totals };

    // ── Writes only, after every read above ──
    tx.set(closingRef, { ...next, createdAt: closingSnap.exists() ? closingSnap.data()?.createdAt : serverTimestamp(), updatedAt: serverTimestamp() });

    for (const [categoryId, bump] of categoryCountBumps.entries()) {
      const categorySnap = categoryById.get(categoryId);
      if (categorySnap && categorySnap.exists()) {
        tx.update(categorySnap.ref, { transactionCount: ((categorySnap.data().transactionCount as number) ?? 0) + bump });
      }
    }

    for (const entry of newEntries) {
      writeFinanceAuditLog(tx, db, {
        module: "closing_expense",
        entityId: entry.id,
        entityLabel: `${date} · ${entry.categoryName}${entry.subcategoryName ? ` · ${entry.subcategoryName}` : ""} · ₹${entry.amount}`,
        action: "create",
        userId,
        userName,
        newValue: entry,
      });
    }

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

  // IMPORTANT: cash_sales (income), cash_expenses, and every deposit event
  // all read-modify-write the SAME cash-drawer account balance. Running
  // those concurrently doesn't just "retry safely" — Firestore aborts and
  // re-runs a transaction's *entire* body (including its reads) from
  // scratch on conflict, and with 3+ transactions all colliding on one
  // document at once, that can cascade into repeated retries and end up
  // slower than doing them one at a time. So: events that share the cash
  // drawer are posted sequentially (never overlapping each other), while
  // events with their own distinct destination account (UPI/Zomato/Swiggy/
  // Other Income) still post concurrently, and the two groups run at the
  // same time as each other. Each event still catches its own failure into
  // a warning — nothing here throws out of the surrounding Promise.all.
  type PostResult = { eventKey: string; txId: string } | { eventKey: string; warning: string } | null;

  const postIncomeEvent = async (event: (typeof incomeEvents)[number]): Promise<PostResult> => {
    if (alreadyPostedEventKeys.has(event.eventKey)) return null;
    if (!(event.amount > 0)) return null;
    const mapping = resolveDestination(event.eventKey, event.eventName, event.amount);
    if (!mapping || !mapping.destinationAccountId) return null;

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
      return { eventKey: event.eventKey, txId: tx.id };
    } catch (err) {
      return { eventKey: event.eventKey, warning: `${event.eventName}: failed to auto-post — ${err instanceof Error ? err.message : "unknown error"}` };
    }
  };

  const postExpenseEvent = async (event: (typeof expenseEvents)[number]): Promise<PostResult> => {
    if (alreadyPostedEventKeys.has(event.eventKey)) return null;
    if (!(event.amount > 0)) return null;

    if (!cashDrawerAccountId) {
      return {
        eventKey: event.eventKey,
        warning: `${event.eventName}: can't determine the cash drawer account — configure "Cash Sales" in Settings > Finance Defaults first. ₹${event.amount} was not posted.`,
      };
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
      return { eventKey: event.eventKey, txId: tx.id };
    } catch (err) {
      return { eventKey: event.eventKey, warning: `${event.eventName}: failed to auto-post — ${err instanceof Error ? err.message : "unknown error"}` };
    }
  };

  // Cash Deposits: one Transfer per deposit type present that day, out of
  // the same cash drawer account into the deposit type's own mapped account.
  const postDepositEvent = async (event: (typeof depositEvents)[number]): Promise<PostResult> => {
    if (alreadyPostedEventKeys.has(event.eventKey)) return null;
    const mapping = resolveDestination(event.eventKey, event.eventName, event.amount);
    if (!mapping || !mapping.destinationAccountId) return null;

    if (!cashDrawerAccountId) {
      return {
        eventKey: event.eventKey,
        warning: `${event.eventName}: can't determine the cash drawer account — configure "Cash Sales" in Settings > Finance Defaults first. ₹${event.amount} was not posted.`,
      };
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
      return { eventKey: event.eventKey, txId: tx.id };
    } catch (err) {
      return { eventKey: event.eventKey, warning: `${event.eventName}: failed to auto-post — ${err instanceof Error ? err.message : "unknown error"}` };
    }
  };

  const cashDrawerIncomeEvents = incomeEvents.filter((e) => e.eventKey === "cash_sales");
  const otherIncomeEvents = incomeEvents.filter((e) => e.eventKey !== "cash_sales");

  const [cashDrawerResults, otherIncomeResults] = await Promise.all([
    // Cash-drawer group: strictly one at a time — these are the events that
    // actually collide with each other.
    (async () => {
      const results: PostResult[] = [];
      for (const event of cashDrawerIncomeEvents) results.push(await postIncomeEvent(event));
      for (const event of expenseEvents) results.push(await postExpenseEvent(event));
      for (const event of depositEvents) results.push(await postDepositEvent(event));
      return results;
    })(),
    // Everything else posts to its own distinct account — safe to overlap.
    Promise.all(otherIncomeEvents.map(postIncomeEvent)),
  ]);

  for (const result of [...cashDrawerResults, ...otherIncomeResults]) {
    if (!result) continue;
    if ("txId" in result) {
      transactionsByEvent[result.eventKey] = result.txId;
    } else {
      warnings.push(result.warning);
    }
  }

  return { transactionsByEvent, warnings };
}

/**
 * Net effect, on the cash drawer account, of one date's worth of posted
 * transactions Daily Closing's own math doesn't already account for — a
 * manual Transfer/Income/Expense hitting the drawer via the Transactions
 * tab (autoPostedSource !== "daily_closing"). Excludes cash_sales,
 * cash_expenses, every *_deposit event, AND cash_recount_adjustment
 * itself — all of those are already reflected in that day's own
 * closingCash, so including them here would double-count. Pure grouping
 * function, no I/O, so both the single-date and full-history callers can
 * share it.
 */
function sumExternalCashDrawerEffectsByDate(transactions: FinanceTransaction[], cashDrawerAccountId: string): Map<string, number> {
  const byDate = new Map<string, number>();
  for (const t of transactions) {
    if (t.autoPostedSource === "daily_closing") continue;
    let delta = 0;
    if (t.toAccountId === cashDrawerAccountId) delta += t.amount;
    if (t.fromAccountId === cashDrawerAccountId) delta -= t.amount;
    if (delta === 0) continue;
    byDate.set(t.date, roundCurrency((byDate.get(t.date) ?? 0) + delta));
  }
  return byDate;
}

/** Single-date convenience wrapper around sumExternalCashDrawerEffectsByDate, for closeDailyClosing/cascadeOpeningCashForward where only one day's value is needed. */
async function computeExternalCashDrawerAdjustment(
  cashDrawerAccountId: string,
  date: string,
  db: Firestore,
  branchId: string,
): Promise<number> {
  const transactions = await getPostedTransactionsForRange(date, date, db, branchId);
  return sumExternalCashDrawerEffectsByDate(transactions, cashDrawerAccountId).get(date) ?? 0;
}

/**
 * The cash drawer account's balance AS OF a specific historical date — NOT
 * the same thing as its `currentBalance` field, which is always "as of
 * right now" and therefore includes every later day's postings too. Using
 * `currentBalance` to reconcile a historical day (from
 * cascadeOpeningCashForward or the one-time backfill, where later locked
 * days almost always already exist) would compare that day's Closing Cash
 * against a balance that already includes weeks of activity that hadn't
 * happened yet — producing exactly the wildly-wrong "target doesn't match
 * the displayed balance" symptom this replaced. Computed the same way
 * getAccountStatement/reconcileAccountBalance do: opening balance + every
 * still-posted (non-voided) transaction's effect on this account, but
 * bounded to `date` instead of "today".
 */
async function computeCashDrawerBalanceAsOfDate(
  accountId: string,
  date: string,
  db: Firestore,
  branchId: string,
): Promise<number | null> {
  const account = await getFinanceAccount(accountId, db);
  if (!account) return null;
  const transactions = await getPostedTransactionsForRange("2000-01-01", date, db, branchId);
  const effect = transactions.reduce((sum, t) => {
    if (t.toAccountId === accountId) return sum + t.amount;
    if (t.fromAccountId === accountId) return sum - t.amount;
    return sum;
  }, 0);
  return roundCurrency(account.openingBalance + effect);
}

/**
 * Business rule (explicit request): the cash drawer's ledger balance must
 * always end up EQUAL to what the Finance Manager actually counted that
 * day (Closing Cash) — the physical count is the real cash balance, not
 * whatever the ledger's own running sum happens to add up to. Independent
 * drift (a missing/unlocked day breaking the Opening Cash chain, cash that
 * left the drawer without an Expense/Deposit line, etc.) is real-world
 * reality this function reconciles away, rather than something the ledger
 * should keep carrying forward silently.
 *
 * Compares the cash drawer's TRUE balance as of this day (see
 * computeCashDrawerBalanceAsOfDate — i.e. AFTER this day's normal Cash
 * Sales/Cash Expenses/Deposit postings already happened) against
 * `closing.closingCash`, and posts one more income or expense transaction
 * for whatever gap remains. This is always a real, visible ledger entry
 * (category "Cash Recount Adjustment") — never a silent balance edit — so
 * it shows up in Transactions/Passbook and explains itself.
 *
 * Callers are responsible for voiding any PREVIOUS recount-adjustment
 * transaction for this same day first (mirroring how cash_sales is
 * handled at each call site) — this function only ever computes fresh
 * against whatever the ledger's true balance already is right now.
 */
// Guards against a concurrent writer (another close, another Sync run, a
// double-click) changing the cash drawer's balance-as-of-this-date between
// our read and our post — see the retry loop in
// reconcileCashDrawerToClosingCash below.
const MAX_RECONCILE_ATTEMPTS = 4;

async function reconcileCashDrawerToClosingCash(
  closing: FinanceDailyClosing,
  userId: string,
  userName: string,
  db: Firestore,
  branchId: string,
): Promise<{ txId: string | null; drift: number; warning: string | null }> {
  if (closing.closingCash === null) return { txId: null, drift: 0, warning: null };

  const defaultsMap = await getFinanceDefaultsMap(db, branchId);
  const cashDrawerAccountId = defaultsMap.get("cash_sales")?.destinationAccountId ?? null;
  if (!cashDrawerAccountId) {
    return {
      txId: null,
      drift: 0,
      warning:
        "Cash Recount Adjustment: no active Finance Defaults mapping configured for Cash Sales — could not sync the ledger to Closing Cash.",
    };
  }

  for (let attempt = 0; attempt < MAX_RECONCILE_ATTEMPTS; attempt++) {
    const balanceAsOfDate = await computeCashDrawerBalanceAsOfDate(cashDrawerAccountId, closing.date, db, branchId);
    if (balanceAsOfDate === null) {
      return { txId: null, drift: 0, warning: "Cash Recount Adjustment: the mapped cash drawer account no longer exists." };
    }

    const drift = roundCurrency(closing.closingCash - balanceAsOfDate);
    if (drift === 0) return { txId: null, drift: 0, warning: null };

    const remarksVerb = drift > 0 ? "up" : "down";
    const remarks = `Auto-posted from Daily Closing — synced the cash drawer ledger balance ${remarksVerb} to the physically counted Closing Cash (₹${closing.closingCash}) for ${closing.date}.`;

    let txId: string;
    try {
      if (drift > 0) {
        const categoryId = await getOrCreateIncomeCategoryIdByName("Cash Recount Adjustment", userId, userName, db, branchId);
        const tx = await createFinanceTransaction(
          {
            type: "income",
            date: closing.date,
            categoryId,
            amount: drift,
            toAccountId: cashDrawerAccountId,
            remarks,
            branchId,
            autoPosted: true,
            autoPostedSource: "daily_closing",
          },
          userId,
          userName,
          db,
        );
        txId = tx.id;
      } else {
        const categoryId = await getOrCreateExpenseCategoryIdByName("Cash Recount Adjustment", userId, userName, db, branchId);
        const tx = await createFinanceTransaction(
          {
            type: "expense",
            date: closing.date,
            categoryId,
            amount: Math.abs(drift),
            fromAccountId: cashDrawerAccountId,
            remarks,
            branchId,
            autoPosted: true,
            autoPostedSource: "daily_closing",
          },
          userId,
          userName,
          db,
        );
        txId = tx.id;
      }
    } catch (err) {
      return {
        txId: null,
        drift: 0,
        warning: `Cash Recount Adjustment: failed to sync the ledger to Closing Cash — ${err instanceof Error ? err.message : "unknown error"}.`,
      };
    }

    // Our read of the balance-as-of-this-date (above) and our post of the
    // adjustment are two separate steps — if something else touched this
    // same account's balance for this same date in between (another close,
    // another Sync run overlapping this one), the amount we just posted
    // was computed from a now-stale number and won't actually land on
    // closing.closingCash. Verify, and if it didn't converge, undo this
    // attempt and recompute fresh rather than leaving a wrong amount posted.
    const verifyBalance = await computeCashDrawerBalanceAsOfDate(cashDrawerAccountId, closing.date, db, branchId);
    const stillOff = verifyBalance === null || roundCurrency(verifyBalance - closing.closingCash) !== 0;
    if (!stillOff) return { txId, drift, warning: null };

    try {
      await voidFinanceTransaction(
        txId,
        userId,
        userName,
        `Recomputing — the cash drawer balance changed while this Cash Recount Adjustment was being posted (attempt ${attempt + 1})`,
        db,
      );
    } catch (err) {
      return {
        txId,
        drift,
        warning: `Cash Recount Adjustment: posted ₹${Math.abs(drift)} but the drawer balance changed concurrently and the correction couldn't be re-verified — please re-run the sync (${err instanceof Error ? err.message : "unknown error"}).`,
      };
    }
  }

  return {
    txId: null,
    drift: 0,
    warning: `Cash Recount Adjustment: the drawer balance kept changing while trying to sync it — please re-run the sync once nothing else is closing a day at the same time.`,
  };
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
// Real chains stop as soon as they resync (see below) — this is just a
// sane upper bound so a data anomaly can never turn into an unbounded loop.
const MAX_CASCADE_DAYS = 3650;

/**
 * Shared by cascadeOpeningCashForward and the historical backfill: voids
 * whatever "Cash Sales" transaction was previously posted for this day (if
 * any) and re-posts it fresh against `draft.cashRevenue` — used whenever
 * Opening Cash for an already-locked day changes (a Closing Cash
 * correction upstream, or a newly-discovered external-transfer
 * adjustment) and the day's own Cash Sales posting needs to catch up.
 * Mutates `autoPosted`/`warnings` in place so callers can fold the result
 * straight into whatever they're about to persist.
 */
async function revoidAndRepostCashSales(
  draft: FinanceDailyClosing,
  autoPosted: Record<string, string>,
  warnings: string[],
  contextNote: string,
  userId: string,
  userName: string,
  db: Firestore,
  branchId: string,
): Promise<void> {
  const oldCashSalesTxId = autoPosted.cash_sales;
  if (oldCashSalesTxId) {
    try {
      await voidFinanceTransaction(oldCashSalesTxId, userId, userName, `Daily Closing for ${draft.date} ${contextNote}`, db);
      delete autoPosted.cash_sales;
    } catch (err) {
      warnings.push(`Cash Sales: could not void the previous posting ${contextNote} — left as-is (${err instanceof Error ? err.message : "unknown error"}).`);
      return; // old posting still live — don't also post a fresh one on top of it
    }
  }

  if (!("cash_sales" in autoPosted) && draft.cashRevenue > 0) {
    try {
      const defaultsMap = await getFinanceDefaultsMap(db, branchId);
      const mapping = defaultsMap.get("cash_sales");
      if (mapping?.isActive && mapping.destinationAccountId) {
        const categoryId = await getOrCreateIncomeCategoryIdByName("Cash Sales", userId, userName, db, branchId);
        const tx = await createFinanceTransaction(
          {
            type: "income",
            date: draft.date,
            categoryId,
            amount: draft.cashRevenue,
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
        autoPosted.cash_sales = tx.id;
      } else {
        warnings.push(`Cash Sales: no active Finance Defaults mapping configured — ₹${draft.cashRevenue} was not re-posted ${contextNote}.`);
      }
    } catch (err) {
      warnings.push(`Cash Sales: failed to re-post ${contextNote} — ${err instanceof Error ? err.message : "unknown error"}.`);
    }
  }
}

/**
 * Shared by cascadeOpeningCashForward and the historical backfill: voids
 * whatever "Cash Recount Adjustment" was previously posted for this day
 * (if any) and computes+posts a fresh one via reconcileCashDrawerToClosingCash.
 * Mutates `autoPosted`/`warnings` in place, same convention as
 * revoidAndRepostCashSales above.
 */
async function revoidAndRepostRecountAdjustment(
  draft: FinanceDailyClosing,
  autoPosted: Record<string, string>,
  warnings: string[],
  contextNote: string,
  userId: string,
  userName: string,
  db: Firestore,
  branchId: string,
): Promise<{ drift: number }> {
  const oldRecountTxId = autoPosted.cash_recount_adjustment;
  if (oldRecountTxId) {
    try {
      await voidFinanceTransaction(oldRecountTxId, userId, userName, `Daily Closing for ${draft.date} ${contextNote}`, db);
      delete autoPosted.cash_recount_adjustment;
    } catch (err) {
      warnings.push(
        `Cash Recount Adjustment: could not void the previous posting ${contextNote} — left as-is (${err instanceof Error ? err.message : "unknown error"}).`,
      );
      return { drift: 0 };
    }
  }

  if (!("cash_recount_adjustment" in autoPosted)) {
    const { txId: recountTxId, drift, warning: recountWarning } = await reconcileCashDrawerToClosingCash(draft, userId, userName, db, branchId);
    if (recountTxId) autoPosted.cash_recount_adjustment = recountTxId;
    if (recountWarning) warnings.push(recountWarning);
    return { drift };
  }
  return { drift: 0 };
}

/**
 * After a day's Closing Cash is set or corrected (see closeDailyClosing),
 * walks forward through any already-LOCKED days chained off it and re-syncs
 * each one's Opening Cash against what it should be right now — the same
 * self-healing resolveOpeningCash() already does automatically for an
 * *unlocked* day, just applied here without waiting for someone to Reopen
 * every downstream day by hand.
 *
 * Only Opening Cash — and therefore Cash Revenue/Total Revenue, and the
 * "Cash Sales" ledger posting derived from Cash Revenue — ever changes
 * here. Closing Cash itself (the manager's physical count), expenses, and
 * deposits are historical fact for that day and are never touched, which is
 * exactly why the walk can stop the moment it finds a day whose Opening
 * Cash is already correct: that day's Closing Cash never changed, so
 * nothing further downstream is affected either. Expense/deposit ledger
 * postings don't depend on Opening Cash, so only "cash_sales" ever needs
 * voiding and re-posting.
 *
 * Stops at the first unlocked day (it'll self-heal the next time it's
 * touched), the first date with no record at all, or the first day already
 * in sync — whichever comes first. Never throws: a failure re-posting one
 * day's Cash Sales is recorded as a warning on that day and the walk
 * continues, so one bad day can't block correcting the rest of the chain.
 * Returns the dates it actually updated, for the caller to surface.
 */
async function cascadeOpeningCashForward(
  fromDate: string,
  userId: string,
  userName: string,
  db: Firestore,
  branchId: string,
): Promise<string[]> {
  const updatedDates: string[] = [];
  let currentDate = nextDateKey(fromDate);

  for (let i = 0; i < MAX_CASCADE_DAYS; i++) {
    const ref = doc(dailyClosingCollection(db), currentDate);
    const snap = await getDoc(ref);
    if (!snap.exists()) break;

    const current = normalizeClosing(snap.data());
    if (!current.locked) break;

    const prevSnap = await getDoc(doc(dailyClosingCollection(db), previousDateKey(currentDate)));
    const resolved = resolveOpeningCash(prevSnap.exists() ? prevSnap.data() : undefined, 0);

    // The one exception to the rule (see applySameDayExternalAdjustment):
    // fold THIS day's own external transfers into its Opening Cash too,
    // recomputed fresh since a Reopen/re-close upstream could have shifted
    // what's actually posted for this exact date.
    const cascadeWarnings: string[] = [];
    let externalCashAdjustment = current.externalCashAdjustment;
    const cashDrawerAccountIdForExternal = (await getFinanceDefaultsMap(db, branchId)).get("cash_sales")?.destinationAccountId ?? null;
    if (cashDrawerAccountIdForExternal) {
      try {
        externalCashAdjustment = await computeExternalCashDrawerAdjustment(cashDrawerAccountIdForExternal, currentDate, db, branchId);
      } catch (err) {
        cascadeWarnings.push(
          `Could not recompute ${currentDate}'s external cash-drawer transfers while re-chaining from ${fromDate} — ${err instanceof Error ? err.message : "unknown error"}.`,
        );
      }
    }
    const effectiveOpeningCash = applySameDayExternalAdjustment(resolved.openingCash, externalCashAdjustment);

    if (
      effectiveOpeningCash === current.openingCash &&
      resolved.openingCashSource === current.openingCashSource &&
      externalCashAdjustment === current.externalCashAdjustment
    ) {
      break;
    }

    const merged = { ...current, openingCash: effectiveOpeningCash, openingCashSource: resolved.openingCashSource, externalCashAdjustment };
    const totals = computeDerivedTotals(merged);
    const draft: FinanceDailyClosing = { ...merged, ...totals };

    // Drop any previous "Cash Sales"/"Cash Recount Adjustment" warning
    // before deciding fresh below — otherwise a stale complaint (e.g. from
    // before Finance Defaults was configured) would keep piling up forever
    // across repeated corrections.
    const warnings = [...cascadeWarnings, ...draft.postingWarnings.filter((w) => !w.startsWith("Cash Sales:") && !w.startsWith("Cash Recount Adjustment:"))];
    const autoPosted = { ...draft.autoPostedTransactionsByEvent };
    const contextNote = `was automatically re-chained after a Closing Cash correction on ${fromDate}`;

    await revoidAndRepostCashSales(draft, autoPosted, warnings, contextNote, userId, userName, db, branchId);

    // Same rule as closeDailyClosing: the cash drawer's balance must always
    // end up equal to this day's own Closing Cash. Opening Cash (and so
    // Cash Sales) may have just shifted above, so re-void and re-post the
    // adjustment fresh against wherever the drawer balance actually landed.
    await revoidAndRepostRecountAdjustment(draft, autoPosted, warnings, contextNote, userId, userName, db, branchId);

    const final: FinanceDailyClosing = { ...draft, autoPostedTransactionsByEvent: autoPosted, postingWarnings: warnings };
    await setDoc(ref, { ...final, updatedAt: serverTimestamp() }, { merge: true });

    await logFinanceAudit(
      {
        module: "closing",
        entityId: currentDate,
        entityLabel: currentDate,
        action: "update",
        userId,
        userName,
        oldValue: { openingCash: current.openingCash, cashRevenue: current.cashRevenue, totalRevenue: current.totalRevenue },
        newValue: { openingCash: final.openingCash, cashRevenue: final.cashRevenue, totalRevenue: final.totalRevenue },
        reason: `Automatically re-chained after ${fromDate}'s Closing Cash was corrected`,
      },
      db,
    );

    updatedDates.push(currentDate);
    currentDate = nextDateKey(currentDate);
  }

  return updatedDates;
}

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

  // The one exception to "Opening Cash is always the previous day's
  // Closing Cash" (see applySameDayExternalAdjustment): fold today's own
  // external transfers into Opening Cash BEFORE Cash Revenue is computed,
  // so they're correctly absorbed here rather than showing up later as a
  // Cash Recount Adjustment that would otherwise cancel them back out.
  const warnings: string[] = [];
  let externalCashAdjustment = 0;
  const cashDrawerAccountIdForExternal = (await getFinanceDefaultsMap(db, branchId)).get("cash_sales")?.destinationAccountId ?? null;
  if (cashDrawerAccountIdForExternal) {
    try {
      externalCashAdjustment = await computeExternalCashDrawerAdjustment(cashDrawerAccountIdForExternal, date, db, branchId);
    } catch (err) {
      warnings.push(
        `Could not compute today's external cash-drawer transfers (Opening Cash may not include them) — ${err instanceof Error ? err.message : "unknown error"}.`,
      );
    }
  }
  const effectiveOpeningCash = applySameDayExternalAdjustment(base.openingCash, externalCashAdjustment);

  const merged = { ...base, openingCash: effectiveOpeningCash, closingCash: roundCurrency(closingCash) };
  const totals = computeDerivedTotals(merged);
  const draft: FinanceDailyClosing = { ...merged, ...totals };

  // Re-close after a reopen: void whatever was posted last time before posting fresh numbers.
  // If a void fails, the old transaction is still live and still affecting the
  // account balance — DON'T re-post that event too, or the amount gets counted
  // twice (once by the un-voided old transaction, once by the new one). Instead
  // leave that event's old transaction reference exactly as it was.
  const unvoidableEventKeys = new Set<string>();
  // cash_sales, cash_expenses, and every *_deposit event all reverse a
  // balance on the SAME cash-drawer account — voiding them concurrently
  // means several Firestore transactions fighting over one document, and a
  // conflicted transaction gets retried from scratch, not just delayed. So:
  // cash-drawer voids run one at a time (never overlapping each other),
  // while voids for events with their own distinct account (UPI/Zomato/
  // Swiggy/Other Income) still run concurrently — and the two groups run
  // at the same time as each other.
  const isCashDrawerEventKey = (eventKey: string) =>
    eventKey === "cash_sales" || eventKey === "cash_expenses" || eventKey === "cash_recount_adjustment" || eventKey.endsWith("_deposit");

  const voidEvent = async (eventKey: string, txId: string) => {
    try {
      await voidFinanceTransaction(txId, userId, userName, `Daily Closing for ${date} was re-saved`, db);
      return null;
    } catch (err) {
      return { eventKey, message: err instanceof Error ? err.message : "unknown error" };
    }
  };

  const allVoidEntries = Object.entries(draft.autoPostedTransactionsByEvent);
  const cashDrawerVoidEntries = allVoidEntries.filter(([eventKey]) => isCashDrawerEventKey(eventKey));
  const otherVoidEntries = allVoidEntries.filter(([eventKey]) => !isCashDrawerEventKey(eventKey));

  const [cashDrawerVoidResults, otherVoidResults] = await Promise.all([
    (async () => {
      const results = [];
      for (const [eventKey, txId] of cashDrawerVoidEntries) results.push(await voidEvent(eventKey, txId));
      return results;
    })(),
    Promise.all(otherVoidEntries.map(([eventKey, txId]) => voidEvent(eventKey, txId))),
  ]);

  for (const failure of [...cashDrawerVoidResults, ...otherVoidResults]) {
    if (!failure) continue;
    unvoidableEventKeys.add(failure.eventKey);
    warnings.push(
      `Could not clean up a previous posting for this event (kept as-is to avoid double-counting): ${failure.message}`,
    );
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

  // Cash drawer balance must always end up equal to the physically counted
  // Closing Cash — see reconcileCashDrawerToClosingCash. Runs last, after
  // this day's normal Cash Sales/Cash Expenses/Deposits are posted above,
  // so it sees (and closes) whatever gap remains. Skipped only if voiding
  // the previous adjustment above failed (unvoidableEventKeys) — in that
  // case the old adjustment is still live and re-posting now would double
  // count, exactly like every other cash-drawer event above.
  if (!unvoidableEventKeys.has("cash_recount_adjustment")) {
    const { txId: recountTxId, warning: recountWarning } = await reconcileCashDrawerToClosingCash(draft, userId, userName, db, branchId);
    if (recountTxId) mergedAutoPosted.cash_recount_adjustment = recountTxId;
    if (recountWarning) warnings.push(recountWarning);
  }

  const closingRef = doc(dailyClosingCollection(db), date);
  let final: FinanceDailyClosing = {
    ...draft,
    externalCashAdjustment,
    locked: true,
    closingTime: toTimeKey(),
    closedBy: userId,
    closedByName: userName,
    autoPostedTransactionsByEvent: mergedAutoPosted,
    postingWarnings: warnings,
  };

  // base (loaded once, up top) already carries this doc's existing createdAt
  // forward through normalizeClosing — no need for a second read here just
  // to recover a field we already have.
  await setDoc(closingRef, {
    ...final,
    createdAt: base.createdAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await logFinanceAudit({ module: "closing", entityId: date, entityLabel: date, action: "close", userId, userName, newValue: final }, db);

  // This day's Closing Cash is now final — if any already-closed later days
  // were chained off a stale value (e.g. this was a re-close after Reopen),
  // bring them back in sync automatically instead of requiring an admin to
  // Reopen each one by hand.
  const cascadedDates = await cascadeOpeningCashForward(date, userId, userName, db, branchId);
  if (cascadedDates.length > 0) {
    const note = `Automatically re-chained Opening Cash and Cash Sales for ${cascadedDates.length} already-closed day(s) after this save: ${cascadedDates.join(", ")}.`;
    final = { ...final, postingWarnings: [...final.postingWarnings, note] };
    await setDoc(closingRef, { postingWarnings: final.postingWarnings, updatedAt: serverTimestamp() }, { merge: true });
  }

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

/** Reopens a locked day so it can be edited again. Values are left in place (not wiped) so the day can just be tweaked and re-saved. Callable by Admin or Finance Manager — always logged (module "closing", action "reopen") with the reason and before/after state. */
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

export interface CashDrawerRecountBackfillResult {
  daysChecked: number;
  /** Days whose Opening Cash changed because of that same day's own external-transfer adjustment (see applySameDayExternalAdjustment). */
  openingCashDaysAdjusted: string[];
  daysAdjusted: string[];
  /** Sum of the absolute drift corrected across every adjusted day — not a running/net total, since a later day's adjustment can partially offset an earlier one. */
  totalAdjustment: number;
  warnings: string[];
}

/**
 * One-time historical fix, applied across the WHOLE locked history in one
 * oldest-to-newest pass, for two rules together:
 *
 * 1. The rule is "Opening Cash is always the previous day's Closing
 *    Cash" — with exactly one exception (applySameDayExternalAdjustment):
 *    a manual Transfer/Income/Expense that hit the cash drawer account on
 *    day D itself (e.g. "Transfer from ICICI") is folded into day D's own
 *    Opening Cash before Cash Revenue is computed, so it's correctly
 *    absorbed there instead of showing up as a Cash Recount Adjustment
 *    that would otherwise (wrongly) cancel it back out at the end of the
 *    same day. A day with no such transfer is untouched by this rule.
 * 2. The cash drawer's ledger balance must always equal that day's own
 *    physically-counted Closing Cash (see reconcileCashDrawerToClosingCash)
 *    — checked AFTER rule 1 above, so by the time this runs, any
 *    known/recorded transfer is already accounted for and only genuinely
 *    unexplained drift remains to be swept up.
 *
 * Must run oldest-to-newest and strictly sequentially (never in
 * parallel): each day's corrections change the numbers the next day's
 * math depends on. Every change is either a real, visible ledger entry
 * ("Cash Sales" re-posted at its corrected amount, "Cash Recount
 * Adjustment" for whatever gap remains) or a plain field correction
 * (Opening Cash, externalCashAdjustment) — never a silent balance edit.
 * Any previous Cash Sales/Recount Adjustment posting for a day is voided
 * before re-posting, so re-running this is safe and idempotent.
 * Admin-only — see app/api/finance/closing/backfill-cash-recount/route.ts.
 */
export async function backfillCashDrawerRecounts(
  userId: string,
  userName: string,
  db: Firestore = defaultFirestore,
  branchId: string = DEFAULT_BRANCH_ID,
): Promise<CashDrawerRecountBackfillResult> {
  const today = toDateKey();
  const allClosings = await getDailyClosingsForRange("2000-01-01", today, db, branchId);
  const lockedClosings = allClosings.filter((c) => c.locked && c.closingCash !== null).sort((a, b) => (a.date < b.date ? -1 : 1));

  const defaultsMap = await getFinanceDefaultsMap(db, branchId);
  const cashDrawerAccountId = defaultsMap.get("cash_sales")?.destinationAccountId ?? null;

  let externalAdjustmentsByDate = new Map<string, number>();
  if (cashDrawerAccountId) {
    const allTransactions = await getPostedTransactionsForRange("2000-01-01", today, db, branchId);
    externalAdjustmentsByDate = sumExternalCashDrawerEffectsByDate(allTransactions, cashDrawerAccountId);
  }

  const openingCashDaysAdjusted: string[] = [];
  const daysAdjusted: string[] = [];
  const warnings: string[] = [];
  let totalAdjustment = 0;

  // Tracks each day's (possibly just-corrected) Closing Cash as we go, so
  // the NEXT iteration's "previous day's Closing Cash" is up to date — a
  // fresh Firestore read would only see last run's numbers.
  const chainedClosingCash = new Map<string, number>();

  for (const closing of lockedClosings) {
    const ref = doc(dailyClosingCollection(db), closing.date);
    const contextNote = "was resynced during a cash-drawer history sync";

    if (!cashDrawerAccountId) {
      warnings.push(`${closing.date}: no active Finance Defaults mapping configured for Cash Sales — skipped.`);
      continue;
    }

    // ── The rule: Opening Cash = previous day's Closing Cash ──
    const prevClosingCash = chainedClosingCash.get(previousDateKey(closing.date));
    const chainedOpeningCash = prevClosingCash !== undefined ? prevClosingCash : closing.openingCash;
    const chainedOpeningCashSource: "chained" | "manual" = prevClosingCash !== undefined ? "chained" : closing.openingCashSource;

    // ── The one exception: fold THIS day's own external transfers in ──
    const thisExternal = externalAdjustmentsByDate.get(closing.date) ?? 0;
    const openingCash = applySameDayExternalAdjustment(chainedOpeningCash, thisExternal);
    const openingCashSource = chainedOpeningCashSource;
    const openingCashChanged = openingCash !== closing.openingCash || openingCashSource !== closing.openingCashSource;
    if (openingCashChanged) openingCashDaysAdjusted.push(closing.date);

    const totals = computeDerivedTotals({
      openingCash,
      expenses: closing.expenses,
      deposits: closing.deposits,
      upiSales: closing.upiSales,
      zomatoSales: closing.zomatoSales,
      swiggySales: closing.swiggySales,
      otherIncome: closing.otherIncome,
      closingCash: closing.closingCash,
    });
    const draft: FinanceDailyClosing = { ...closing, openingCash, openingCashSource, externalCashAdjustment: thisExternal, ...totals };

    const autoPosted = { ...closing.autoPostedTransactionsByEvent };
    const warningsForDay = closing.postingWarnings.filter((w) => !w.startsWith("Cash Sales:") && !w.startsWith("Cash Recount Adjustment:"));

    if (openingCashChanged) {
      await revoidAndRepostCashSales(draft, autoPosted, warningsForDay, contextNote, userId, userName, db, branchId);
    }

    // ── Rule 2: drawer balance must equal this day's own Closing Cash ──
    const { drift: recountDrift } = await revoidAndRepostRecountAdjustment(
      draft,
      autoPosted,
      warningsForDay,
      contextNote,
      userId,
      userName,
      db,
      branchId,
    );
    if (autoPosted.cash_recount_adjustment && recountDrift !== 0) {
      daysAdjusted.push(closing.date);
      totalAdjustment = roundCurrency(totalAdjustment + Math.abs(recountDrift));
    }

    warnings.push(...warningsForDay.filter((w) => !closing.postingWarnings.includes(w)).map((w) => `${closing.date}: ${w}`));

    chainedClosingCash.set(closing.date, closing.closingCash as number);

    await setDoc(
      ref,
      {
        openingCash: draft.openingCash,
        openingCashSource: draft.openingCashSource,
        cashExpenseTotal: draft.cashExpenseTotal,
        depositTotal: draft.depositTotal,
        totalCashOut: draft.totalCashOut,
        cashRevenue: draft.cashRevenue,
        totalRevenue: draft.totalRevenue,
        externalCashAdjustment: thisExternal,
        autoPostedTransactionsByEvent: autoPosted,
        postingWarnings: warningsForDay,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }

  if (daysAdjusted.length > 0 || openingCashDaysAdjusted.length > 0 || warnings.length > 0) {
    await logFinanceAudit(
      {
        module: "closing",
        entityId: "cash_drawer_recount_backfill",
        entityLabel: "Cash Drawer Recount Backfill",
        action: "backfill",
        userId,
        userName,
        newValue: { openingCashDaysAdjusted, daysAdjusted, warnings },
      },
      db,
    );
  }

  return { daysChecked: lockedClosings.length, openingCashDaysAdjusted, daysAdjusted, totalAdjustment, warnings };
}
