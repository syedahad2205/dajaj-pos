import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
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
  canEditDailyClosingDate,
  ClosingSequenceError,
  dailyClosingWorkDate,
  nextDateKey,
  previousDateKey,
  roundCurrency,
  toDateKey,
  toTimeKey,
  netCashDrawerTransferAdjustment,
  computeDailyClosingTotals,
  dailyClosingPostingEvents,
  computeEstimatedSales,
  expectedOpeningFromPrevious,
  unexplainedStockMismatches,
  DEFAULT_STOCK_PRICING,
  EMPTY_SHAWARMA_COUNTS,
  SHAWARMA_KINDS,
  type DailyClosingStockEntry,
  type EstimatedSales,
  type ShawarmaCounts,
  type ShawarmaPrices,
  type StockPricingConfig,
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

export interface DailyClosingWorkTarget {
  latestLockedDate: string | null;
  workDate: string;
  firstDay: boolean;
}

export async function getLatestLockedClosing(
  db: Firestore = defaultFirestore,
  branchId: string = DEFAULT_BRANCH_ID,
): Promise<FinanceDailyClosing | null> {
  const snapshot = await getDocs(
    query(
      dailyClosingCollection(db),
      where("branchId", "==", branchId),
      where("locked", "==", true),
      orderBy("date", "desc"),
      limit(1),
    ),
  );
  const row = snapshot.docs[0]?.data();
  return row ? normalizeClosing(row) : null;
}

async function getLatestLockedClosingDate(db: Firestore, branchId: string): Promise<string | null> {
  return (await getLatestLockedClosing(db, branchId))?.date ?? null;
}

export async function getDailyClosingWorkTarget(
  db: Firestore = defaultFirestore,
  branchId: string = DEFAULT_BRANCH_ID,
): Promise<DailyClosingWorkTarget> {
  const today = toDateKey();
  const latestLockedDate = await getLatestLockedClosingDate(db, branchId);
  return {
    latestLockedDate,
    workDate: dailyClosingWorkDate(latestLockedDate, today),
    firstDay: latestLockedDate === null,
  };
}

async function assertCanEditDailyClosingDate(
  date: string,
  db: Firestore,
  branchId: string,
): Promise<DailyClosingWorkTarget> {
  if (!isValidDateKey(date)) throw new Error("Invalid date.");
  const target = await getDailyClosingWorkTarget(db, branchId);
  if (!canEditDailyClosingDate(date, target.latestLockedDate, toDateKey())) {
    if (await isEditableReopenedDay(date, db)) return target;
    throw new ClosingSequenceError(target.workDate, target.latestLockedDate);
  }
  return target;
}

/**
 * A past day that was Reopened while later days are still locked sits
 * behind the normal work date, but it must stay editable/closable or it is
 * stranded open forever. Allowed only when its Opening Cash can still chain:
 * the previous day is locked, or this day uses a manual Opening Cash (the
 * very first day). Re-closing it cascades the corrected Closing Cash forward
 * through the later locked days (cascadeOpeningCashForward).
 */
async function isEditableReopenedDay(date: string, db: Firestore): Promise<boolean> {
  if (date > toDateKey()) return false;
  const [snap, prevSnap] = await Promise.all([
    getDoc(doc(dailyClosingCollection(db), date)),
    getDoc(doc(dailyClosingCollection(db), previousDateKey(date))),
  ]);
  if (!snap.exists()) return false;
  const existing = normalizeClosing(snap.data());
  if (existing.locked || (existing.reopenCount ?? 0) < 1) return false;
  if (prevSnap.exists() && Boolean(prevSnap.data().locked)) return true;
  // Raw field, not normalizeClosing's "manual" fallback for legacy docs.
  return snap.data().openingCashSource === "manual" && !prevSnap.exists();
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
    juiceLabRevenue: 0,
    juiceLabCollected: 0,
    juiceLabPending: 0,
    upiNetSales: 0,
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
    cashDrawerBalanceAsOfDate: null,
    autoPostedTransactionsByEvent: {},
    postingWarnings: [],
    stock: [],
    shawarmaSold: { ...EMPTY_SHAWARMA_COUNTS },
    shawarmaPrices: null,
    estimatedSales: computeEstimatedSales([], EMPTY_SHAWARMA_COUNTS, null),
  };
}

/** See computeDailyClosingTotals in lib/finance.ts (pure, so scripts/verify-juice-lab.ts can test the exact same math). JUICE LAB INVARIANT: keep this a plain delegate — don't add revenue math here. */
function computeDerivedTotals(input: Parameters<typeof computeDailyClosingTotals>[0]) {
  return computeDailyClosingTotals(input);
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
  const juiceLabRevenue = typeof raw.juiceLabRevenue === "number" ? raw.juiceLabRevenue : 0;
  const juiceLabCollected = typeof raw.juiceLabCollected === "number" ? raw.juiceLabCollected : 0;
  const closingCash = typeof raw.closingCash === "number" ? raw.closingCash : null;
  // 0 for any day this hasn't been computed for yet (legacy docs, or a day
  // that hasn't been through closeDailyClosing/the history resync since
  // this field was introduced) — resolveOpeningCash treats that as "no
  // external transfers known for that day", same as before this existed.
  const externalCashAdjustment = typeof raw.externalCashAdjustment === "number" ? raw.externalCashAdjustment : 0;
  const cashDrawerBalanceAsOfDate = typeof raw.cashDrawerBalanceAsOfDate === "number" ? raw.cashDrawerBalanceAsOfDate : null;

  const totals = computeDerivedTotals({
    openingCash,
    expenses,
    deposits,
    upiSales,
    zomatoSales,
    swiggySales,
    otherIncome,
    juiceLabRevenue,
    juiceLabCollected,
    closingCash,
  });

  return {
    id: raw.id ?? raw.date,
    date: raw.date,
    branchId: raw.branchId ?? DEFAULT_BRANCH_ID,
    openingCash,
    openingCashSource,
    externalCashAdjustment,
    cashDrawerBalanceAsOfDate,
    expenses,
    deposits,
    upiSales,
    zomatoSales,
    swiggySales,
    otherIncome,
    juiceLabRevenue,
    juiceLabCollected,
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
    ...normalizeStockFields(raw),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Stock fields of a raw day doc (absent on days saved before stock tracking). estimatedSales is always recomputed. */
function normalizeStockFields(raw: DocumentData): {
  stock: DailyClosingStockEntry[];
  shawarmaSold: ShawarmaCounts;
  shawarmaPrices: ShawarmaPrices | null;
  estimatedSales: EstimatedSales;
} {
  const stock: DailyClosingStockEntry[] = Array.isArray(raw.stock)
    ? raw.stock
        .filter((r: DocumentData) => r && typeof r.itemId === "string")
        .map((r: DocumentData) => ({
          itemId: r.itemId,
          itemName: typeof r.itemName === "string" ? r.itemName : r.itemId,
          opening: numberOrNull(r.opening),
          closing: numberOrNull(r.closing),
          order: numberOrNull(r.order),
          unitPrice: numberOrNull(r.unitPrice),
          mismatchReason: typeof r.mismatchReason === "string" && r.mismatchReason.trim() ? r.mismatchReason.trim() : null,
        }))
    : [];
  const shawarmaSold = { ...EMPTY_SHAWARMA_COUNTS };
  for (const k of SHAWARMA_KINDS) shawarmaSold[k.key] = numberOrNull(raw.shawarmaSold?.[k.key]) ?? 0;
  const shawarmaPrices =
    raw.shawarmaPrices && typeof raw.shawarmaPrices === "object"
      ? (Object.fromEntries(SHAWARMA_KINDS.map((k) => [k.key, numberOrNull(raw.shawarmaPrices[k.key]) ?? 0])) as unknown as ShawarmaPrices)
      : null;
  return { stock, shawarmaSold, shawarmaPrices, estimatedSales: computeEstimatedSales(stock, shawarmaSold, shawarmaPrices) };
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
 * day's Closing Cash": if money was transferred into/out of the
 * drawer on THIS SAME day via a Transfer on the Transactions tab (e.g.
 * "Transfer from ICICI") — not Income, Expense, Pigmi, or sales — that
 * amount is folded into THIS day's own Opening Cash before Cash Revenue is
 * computed, so it's correctly absorbed there instead of showing up as a
 * Cash Recount Adjustment that would otherwise (wrongly) cancel it back
 * out at the end of the same day. A day with no such transfer passes
 * through unchanged — the rule (previous day's Closing Cash) holds exactly.
 */
function applySameDayExternalAdjustment(chainedOpeningCash: number, externalCashAdjustment: number): number {
  return roundCurrency(chainedOpeningCash + externalCashAdjustment);
}

/** Manual Opening Cash with any previously folded transfer taken back out, so a later load can apply today's transfers once instead of stacking them. */
function manualOpeningBeforeExternal(existing: FinanceDailyClosing): number {
  if (existing.openingCashSource !== "manual") return 0;
  return roundCurrency(existing.openingCash - existing.externalCashAdjustment);
}

function mergeOpeningWithExternal(
  base: FinanceDailyClosing,
  resolved: { openingCash: number; openingCashSource: "chained" | "manual" },
  externalCashAdjustment: number,
): FinanceDailyClosing {
  const merged = {
    ...base,
    openingCash: applySameDayExternalAdjustment(resolved.openingCash, externalCashAdjustment),
    openingCashSource: resolved.openingCashSource,
    externalCashAdjustment,
  };
  return { ...merged, ...computeDerivedTotals(merged) };
}

/** Net Cash Drawer Transfers for this date (type=transfer only). 0 if Cash Sales isn't mapped. */
async function lookupExternalCashDrawerAdjustment(date: string, db: Firestore, branchId: string): Promise<number> {
  const cashDrawerAccountId = (await getFinanceDefaultsMap(db, branchId)).get("cash_sales")?.destinationAccountId ?? null;
  if (!cashDrawerAccountId) return 0;
  try {
    return await computeExternalCashDrawerAdjustment(cashDrawerAccountId, date, db, branchId);
  } catch {
    return 0;
  }
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
    const resolved = resolveOpeningCash(prevSnap.exists() ? prevSnap.data() : undefined, manualOpeningBeforeExternal(existing));
    const merged = { ...existing, openingCash: resolved.openingCash, openingCashSource: resolved.openingCashSource };
    return { ...merged, ...computeDerivedTotals(merged) };
  }

  const resolved = resolveOpeningCash(prevSnap.exists() ? prevSnap.data() : undefined, 0);
  return emptyClosing(date, branchId, resolved.openingCash, resolved.openingCashSource);
}

/**
 * Non-transactional counterpart of loadOrBootstrapClosingInTx — used by
 * read-only views and by closeDailyClosing. Unlocked days re-resolve
 * Opening Cash = previous locked Closing Cash + today's Cash Drawer
 * Transfers (GET must show transfers made during the day). Locked days
 * are returned as stored so opening/closing stay frozen after close.
 */
async function loadOrBootstrapClosing(date: string, db: Firestore, branchId: string): Promise<FinanceDailyClosing> {
  const snap = await getDoc(doc(dailyClosingCollection(db), date));
  if (snap.exists()) {
    const existing = normalizeClosing(snap.data());
    if (existing.locked) return existing;
  }

  await assertCanEditDailyClosingDate(date, db, branchId);

  const prevSnap = await getDoc(doc(dailyClosingCollection(db), previousDateKey(date)));
  if (snap.exists()) {
    const existing = normalizeClosing(snap.data());
    const existingManual = manualOpeningBeforeExternal(existing);
    const resolved = resolveOpeningCash(prevSnap.exists() ? prevSnap.data() : undefined, existingManual);
    const externalCashAdjustment = await lookupExternalCashDrawerAdjustment(date, db, branchId);
    return mergeOpeningWithExternal(existing, resolved, externalCashAdjustment);
  }

  const resolved = resolveOpeningCash(prevSnap.exists() ? prevSnap.data() : undefined, 0);
  const externalCashAdjustment = await lookupExternalCashDrawerAdjustment(date, db, branchId);
  return mergeOpeningWithExternal(emptyClosing(date, branchId, resolved.openingCash, resolved.openingCashSource), resolved, externalCashAdjustment);
}

/**
 * Read-only view for the Daily Closing screen. If no document exists yet
 * for this date, returns a freshly-computed (not persisted) draft so the
 * screen has something to render before the manager adds anything —
 * viewing a date should never write to the database.
 * Unlocked dates that are not the day after the last locked closing throw
 * without reading transfers or bootstrapping a draft.
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
  await assertCanEditDailyClosingDate(date, db, branchId);

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
  await assertCanEditDailyClosingDate(date, db, branchId);

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
  await assertCanEditDailyClosingDate(date, db, branchId);
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
  await assertCanEditDailyClosingDate(date, db, branchId);

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
  await assertCanEditDailyClosingDate(date, db, branchId);
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
  juiceLabRevenue?: number;
  juiceLabCollected?: number;
}

/** Updates the day's manually-entered sales totals. No "which bank / which account" — those are recorded later at settlement. */
export async function updateDailyClosingSales(
  date: string,
  input: UpdateSalesInput,
  db: Firestore = defaultFirestore,
  branchId: string = DEFAULT_BRANCH_ID,
): Promise<FinanceDailyClosing> {
  await assertCanEditDailyClosingDate(date, db, branchId);
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
      juiceLabRevenue:
        input.juiceLabRevenue !== undefined ? Math.max(0, roundCurrency(input.juiceLabRevenue)) : base.juiceLabRevenue,
      juiceLabCollected:
        input.juiceLabCollected !== undefined ? Math.max(0, roundCurrency(input.juiceLabCollected)) : base.juiceLabCollected,
    };
    // JUICE LAB INVARIANT: collected ≤ revenue is the only check. Pending larger
    // than today's UPI is valid (paid from the whole UPI balance) — don't block it.
    if (merged.juiceLabCollected > merged.juiceLabRevenue) {
      throw new Error("Juice Lab collected can't be more than Juice Lab revenue.");
    }
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
  await assertCanEditDailyClosingDate(date, db, branchId);

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
function getExpectedPostingEvents(closing: FinanceDailyClosing) {
  return dailyClosingPostingEvents(closing);
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

  // JUICE LAB INVARIANT (rule 4 in lib/finance.ts): out of the UPI account,
  // and MUST keep autoPostedSource "daily_closing" so pnlLedgerTransactions
  // never counts it as a business expense.
  const postJuiceLabPayout = async (event: (typeof expenseEvents)[number]): Promise<PostResult> => {
    if (alreadyPostedEventKeys.has(event.eventKey)) return null;
    if (!(event.amount > 0)) return null;
    const upiMapping = resolveDestination("upi_sales", event.eventName, event.amount);
    if (!upiMapping || !upiMapping.destinationAccountId) return null;

    try {
      const categoryId = await getOrCreateExpenseCategoryIdByName("Juice Lab Payout", userId, userName, db, branchId);
      const tx = await createFinanceTransaction(
        {
          type: "expense",
          date: closing.date,
          categoryId,
          amount: event.amount,
          fromAccountId: upiMapping.destinationAccountId,
          remarks: "Auto-posted from Daily Closing (Juice Lab's pending share, paid from UPI — not a business expense)",
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
  const upiIncomeEvents = incomeEvents.filter((e) => e.eventKey === "upi_sales");
  const otherIncomeEvents = incomeEvents.filter((e) => e.eventKey !== "cash_sales" && e.eventKey !== "upi_sales");
  const cashDrawerExpenseEvents = expenseEvents.filter((e) => e.eventKey !== "juice_lab_payout");
  const juiceLabPayoutEvents = expenseEvents.filter((e) => e.eventKey === "juice_lab_payout");

  const [cashDrawerResults, upiResults, otherIncomeResults] = await Promise.all([
    // Cash-drawer group: strictly one at a time — these are the events that
    // actually collide with each other.
    (async () => {
      const results: PostResult[] = [];
      for (const event of cashDrawerIncomeEvents) results.push(await postIncomeEvent(event));
      for (const event of cashDrawerExpenseEvents) results.push(await postExpenseEvent(event));
      for (const event of depositEvents) results.push(await postDepositEvent(event));
      return results;
    })(),
    // UPI account group: UPI Sales in, then Juice Lab's share out — one at a time
    // (same account, so running them together would just fight over it).
    (async () => {
      const results: PostResult[] = [];
      for (const event of upiIncomeEvents) results.push(await postIncomeEvent(event));
      for (const event of juiceLabPayoutEvents) results.push(await postJuiceLabPayout(event));
      return results;
    })(),
    // Everything else posts to its own distinct account — safe to overlap.
    Promise.all(otherIncomeEvents.map(postIncomeEvent)),
  ]);

  for (const result of [...cashDrawerResults, ...upiResults, ...otherIncomeResults]) {
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
 * Net Cash Drawer Transfers by date (into minus out). Transfer rows only;
 * Daily Closing auto-posts, Income, and Expense never participate.
 */
function sumExternalCashDrawerEffectsByDate(transactions: FinanceTransaction[], cashDrawerAccountId: string): Map<string, number> {
  const txsByDate = new Map<string, FinanceTransaction[]>();
  for (const t of transactions) {
    const list = txsByDate.get(t.date) ?? [];
    list.push(t);
    txsByDate.set(t.date, list);
  }
  const byDate = new Map<string, number>();
  for (const [date, txs] of txsByDate) {
    const net = netCashDrawerTransferAdjustment(txs, cashDrawerAccountId);
    if (net !== 0) byDate.set(date, net);
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
function cashDrawerLedgerEffect(t: FinanceTransaction, accountId: string): number {
  let delta = 0;
  if (t.toAccountId === accountId) delta += t.amount;
  if (t.fromAccountId === accountId) delta -= t.amount;
  return delta;
}

async function computeCashDrawerBalanceAsOfDate(
  accountId: string,
  date: string,
  db: Firestore,
  branchId: string,
): Promise<number | null> {
  const account = await getFinanceAccount(accountId, db);
  if (!account) return null;

  const prevSnap = await getDoc(doc(dailyClosingCollection(db), previousDateKey(date)));
  let startBalance: number | null = null;
  if (prevSnap.exists()) {
    const prev = normalizeClosing(prevSnap.data());
    // Recount checkpoint only — never used as next-day openingCash.
    if (typeof prev.cashDrawerBalanceAsOfDate === "number") {
      startBalance = prev.cashDrawerBalanceAsOfDate;
    } else if (prev.locked && typeof prev.closingCash === "number") {
      // Pre-migration locked days: recount already forced the ledger to closingCash.
      // That identity is a recount starting point only — opening cash still uses closingCash via resolveOpeningCash, never this scan.
      startBalance = prev.closingCash;
    }
  }

  if (startBalance !== null) {
    const todayTransactions = await getPostedTransactionsForRange(date, date, db, branchId);
    const todayEffect = todayTransactions.reduce((sum, t) => sum + cashDrawerLedgerEffect(t, accountId), 0);
    return roundCurrency(startBalance + todayEffect);
  }

  // No previous locked day / checkpoint: do not scan the full ledger.
  return null;
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
 * Recomputes one already-locked day's Opening Cash (previous Closing Cash
 * + that day's own cash-drawer transfers) and re-posts Cash Sales / recount
 * if the numbers moved. Used by the forward cascade and when a Transfer
 * hits the cash drawer after that day was already closed.
 */
async function rechainLockedClosingAt(
  date: string,
  userId: string,
  userName: string,
  db: Firestore,
  branchId: string,
  contextNote: string,
  auditReason: string,
): Promise<"updated" | "unchanged" | "skipped"> {
  const ref = doc(dailyClosingCollection(db), date);
  const snap = await getDoc(ref);
  if (!snap.exists()) return "skipped";

  const current = normalizeClosing(snap.data());
  if (!current.locked) return "skipped";

  const prevSnap = await getDoc(doc(dailyClosingCollection(db), previousDateKey(date)));
  const resolved = resolveOpeningCash(prevSnap.exists() ? prevSnap.data() : undefined, manualOpeningBeforeExternal(current));

  const cascadeWarnings: string[] = [];
  let externalCashAdjustment = current.externalCashAdjustment;
  const cashDrawerAccountIdForExternal = (await getFinanceDefaultsMap(db, branchId)).get("cash_sales")?.destinationAccountId ?? null;
  if (cashDrawerAccountIdForExternal) {
    try {
      externalCashAdjustment = await computeExternalCashDrawerAdjustment(cashDrawerAccountIdForExternal, date, db, branchId);
    } catch (err) {
      cascadeWarnings.push(
        `Could not recompute ${date}'s external cash-drawer transfers ${contextNote} — ${err instanceof Error ? err.message : "unknown error"}.`,
      );
    }
  }
  const effectiveOpeningCash = applySameDayExternalAdjustment(resolved.openingCash, externalCashAdjustment);

  if (
    effectiveOpeningCash === current.openingCash &&
    resolved.openingCashSource === current.openingCashSource &&
    externalCashAdjustment === current.externalCashAdjustment
  ) {
    return "unchanged";
  }

  const merged = { ...current, openingCash: effectiveOpeningCash, openingCashSource: resolved.openingCashSource, externalCashAdjustment };
  const totals = computeDerivedTotals(merged);
  const draft: FinanceDailyClosing = { ...merged, ...totals };

  const warnings = [...cascadeWarnings, ...draft.postingWarnings.filter((w) => !w.startsWith("Cash Sales:") && !w.startsWith("Cash Recount Adjustment:"))];
  const autoPosted = { ...draft.autoPostedTransactionsByEvent };

  await revoidAndRepostCashSales(draft, autoPosted, warnings, contextNote, userId, userName, db, branchId);
  await revoidAndRepostRecountAdjustment(draft, autoPosted, warnings, contextNote, userId, userName, db, branchId);

  let cashDrawerBalanceAsOfDate = current.cashDrawerBalanceAsOfDate;
  if (cashDrawerAccountIdForExternal) {
    cashDrawerBalanceAsOfDate = await computeCashDrawerBalanceAsOfDate(cashDrawerAccountIdForExternal, date, db, branchId);
  }

  const final: FinanceDailyClosing = {
    ...draft,
    autoPostedTransactionsByEvent: autoPosted,
    postingWarnings: warnings,
    cashDrawerBalanceAsOfDate,
  };
  await setDoc(ref, { ...final, updatedAt: serverTimestamp() }, { merge: true });

  await logFinanceAudit(
    {
      module: "closing",
      entityId: date,
      entityLabel: date,
      action: "update",
      userId,
      userName,
      oldValue: { openingCash: current.openingCash, cashRevenue: current.cashRevenue, totalRevenue: current.totalRevenue },
      newValue: { openingCash: final.openingCash, cashRevenue: final.cashRevenue, totalRevenue: final.totalRevenue },
      reason: auditReason,
    },
    db,
  );

  return "updated";
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
    const result = await rechainLockedClosingAt(
      currentDate,
      userId,
      userName,
      db,
      branchId,
      `was automatically re-chained after a Closing Cash correction on ${fromDate}`,
      `Automatically re-chained after ${fromDate}'s Closing Cash was corrected`,
    );
    if (result !== "updated") break;
    updatedDates.push(currentDate);
    currentDate = nextDateKey(currentDate);
  }

  return updatedDates;
}

/**
 * When a manager posts (or voids) a Transfer that hits the cash drawer,
 * unlocked Daily Closing GET/Close already fold it into Opening Cash.
 * Locked days stay frozen (next day's base is this day's closingCash).
 */
export async function refreshDailyClosingForCashDrawerTransaction(
  transaction: Pick<FinanceTransaction, "date" | "type" | "fromAccountId" | "toAccountId" | "autoPostedSource" | "branchId">,
  _userId: string,
  _userName: string,
  _db: Firestore = defaultFirestore,
): Promise<void> {
  if (transaction.autoPostedSource === "daily_closing") return;
  if (transaction.type !== "transfer") return;
  if (!isValidDateKey(transaction.date)) return;
  // Unlocked days: getDailyClosingView live-computes opening cash.
  // Locked days: opening/closing stay as saved until an explicit Reopen.
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

  // Stock chain: today's Opening must equal yesterday's Closing + Order, or carry a reason.
  if (base.stock.length > 0) {
    const prevSnap = await getDoc(doc(dailyClosingCollection(db), previousDateKey(date)));
    const expected = expectedOpeningFromPrevious(prevSnap.exists() ? normalizeClosing(prevSnap.data()).stock : null);
    const mismatches = unexplainedStockMismatches(base.stock, expected);
    if (mismatches.length > 0) {
      throw new Error(
        `Stock opening doesn't match yesterday's closing + order for ${mismatches
          .map((m) => `${m.itemName} (${m.opening} vs ${m.expected})`)
          .join(", ")}. Fix the opening or add a reason in the Stock section.`,
      );
    }
  }

  // Recompute today's cash-drawer transfers fresh at save time (load already
  // folded in whatever it could see). Subtract the load-time adjustment first
  // so we never apply the same transfer twice.
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
  const chainedOpeningCash = roundCurrency(base.openingCash - base.externalCashAdjustment);
  const effectiveOpeningCash = applySameDayExternalAdjustment(chainedOpeningCash, externalCashAdjustment);

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

  let cashDrawerBalanceAsOfDate: number | null = null;
  if (cashDrawerAccountIdForExternal) {
    cashDrawerBalanceAsOfDate = await computeCashDrawerBalanceAsOfDate(cashDrawerAccountIdForExternal, date, db, branchId);
    if (cashDrawerBalanceAsOfDate === null) cashDrawerBalanceAsOfDate = roundCurrency(closingCash);
  }

  const closingRef = doc(dailyClosingCollection(db), date);
  let final: FinanceDailyClosing = {
    ...draft,
    externalCashAdjustment,
    cashDrawerBalanceAsOfDate,
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
  const closings = snapshot.docs.map((d) => normalizeClosing(d.data()));
  return closings;
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
 *    a manual Transfer that hit the cash drawer account on day D itself
 *    (e.g. "Transfer from ICICI") is folded into day D's own Opening Cash
 *    before Cash Revenue is computed, so it's correctly absorbed there
 *    instead of showing up as a Cash Recount Adjustment that would
 *    otherwise (wrongly) cancel it back out at the end of the same day.
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
      juiceLabRevenue: closing.juiceLabRevenue,
      juiceLabCollected: closing.juiceLabCollected,
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

    const cashDrawerBalanceAsOfDate = cashDrawerAccountId
      ? await computeCashDrawerBalanceAsOfDate(cashDrawerAccountId, closing.date, db, branchId)
      : null;

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
        cashDrawerBalanceAsOfDate,
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

// ─────────────────────────────────────────────────────────────────────────
// Daily stock + estimated sales — see the rules above DailyClosingStockEntry
// in lib/finance.ts. Prices live in finance_stock_config/main.
// ─────────────────────────────────────────────────────────────────────────

function stockConfigRef(db: Firestore) {
  return doc(collection(db, "finance_stock_config"), "main");
}

function normalizeStockConfig(raw: DocumentData | undefined): StockPricingConfig {
  if (!raw) {
    return {
      items: DEFAULT_STOCK_PRICING.items.map((i) => ({ ...i })),
      shawarmaPrices: { ...DEFAULT_STOCK_PRICING.shawarmaPrices },
      staff: DEFAULT_STOCK_PRICING.staff.map((p) => ({ ...p })),
    };
  }
  const items = Array.isArray(raw.items)
    ? raw.items
        .filter((i: DocumentData) => i && typeof i.id === "string" && typeof i.name === "string")
        .map((i: DocumentData, index: number) => ({
          id: i.id,
          name: i.name,
          unitPrice: numberOrNull(i.unitPrice),
          active: i.active !== false,
          displayOrder: typeof i.displayOrder === "number" ? i.displayOrder : index + 1,
        }))
        .sort((a: { displayOrder: number }, b: { displayOrder: number }) => a.displayOrder - b.displayOrder)
    : DEFAULT_STOCK_PRICING.items.map((i) => ({ ...i }));
  const shawarmaPrices = { ...DEFAULT_STOCK_PRICING.shawarmaPrices };
  for (const k of SHAWARMA_KINDS) shawarmaPrices[k.key] = numberOrNull(raw.shawarmaPrices?.[k.key]) ?? shawarmaPrices[k.key];
  const staff = Array.isArray(raw.staff)
    ? raw.staff
        .filter((p: DocumentData) => p && typeof p.id === "string" && typeof p.name === "string")
        .map((p: DocumentData) => ({ id: p.id, name: p.name, dailySalary: numberOrNull(p.dailySalary), active: p.active !== false }))
    : DEFAULT_STOCK_PRICING.staff.map((p) => ({ ...p }));
  return { items, shawarmaPrices, staff };
}

/** Stock items + prices. Falls back to the built-in defaults until an Admin saves them. */
export async function getStockPricingConfig(db: Firestore = defaultFirestore): Promise<StockPricingConfig> {
  const snap = await getDoc(stockConfigRef(db));
  return normalizeStockConfig(snap.exists() ? snap.data() : undefined);
}

/** Admin-only (enforced by the route and firestore.rules). Only affects days whose stock is saved from now on. */
export async function saveStockPricingConfig(
  input: StockPricingConfig,
  userId: string,
  userName: string,
  db: Firestore = defaultFirestore,
): Promise<StockPricingConfig> {
  const seen = new Set<string>();
  const items = (Array.isArray(input.items) ? input.items : []).map((i, index) => {
    const name = String(i.name ?? "").trim();
    if (!name) throw new Error("Every stock item needs a name.");
    const id = String(i.id ?? "").trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (!id || seen.has(id)) throw new Error(`Duplicate or invalid stock item "${name}".`);
    seen.add(id);
    const unitPrice = i.unitPrice === null || i.unitPrice === undefined || (i.unitPrice as unknown) === "" ? null : Number(i.unitPrice);
    if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) throw new Error(`Price for ${name} must be a positive number or empty.`);
    return { id, name, unitPrice: unitPrice === null ? null : roundCurrency(unitPrice), active: i.active !== false, displayOrder: index + 1 };
  });
  const shawarmaPrices = { ...DEFAULT_STOCK_PRICING.shawarmaPrices };
  for (const k of SHAWARMA_KINDS) {
    const v = Number(input.shawarmaPrices?.[k.key]);
    if (!Number.isFinite(v) || v < 0) throw new Error(`${k.label} price must be a positive number.`);
    shawarmaPrices[k.key] = roundCurrency(v);
  }
  const seenStaff = new Set<string>();
  const staff = (Array.isArray(input.staff) ? input.staff : []).map((p) => {
    const name = String(p.name ?? "").trim();
    if (!name) throw new Error("Every staff member needs a name.");
    const id = String(p.id ?? "").trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (!id || seenStaff.has(id)) throw new Error(`Duplicate or invalid staff member "${name}".`);
    seenStaff.add(id);
    const salary = p.dailySalary === null || p.dailySalary === undefined || (p.dailySalary as unknown) === "" ? null : Number(p.dailySalary);
    if (salary !== null && (!Number.isFinite(salary) || salary < 0)) throw new Error(`Daily salary for ${name} must be a positive number or empty.`);
    return { id, name, dailySalary: salary === null ? null : roundCurrency(salary), active: p.active !== false };
  });
  const before = await getStockPricingConfig(db);
  const next: StockPricingConfig = { items, shawarmaPrices, staff };
  await setDoc(stockConfigRef(db), { ...next, updatedBy: userId, updatedByName: userName, updatedAt: serverTimestamp() });
  await logFinanceAudit(
    { module: "stock", entityId: "pricing", entityLabel: "Stock, shawarma & salary settings", action: "update", userId, userName, oldValue: before, newValue: next },
    db,
  );
  return next;
}

export interface DailyClosingStockView {
  date: string;
  locked: boolean;
  config: StockPricingConfig;
  stock: DailyClosingStockEntry[];
  shawarmaSold: ShawarmaCounts;
  shawarmaPrices: ShawarmaPrices | null;
  estimatedSales: EstimatedSales;
  /** Per item: previous day's Closing + Order. Empty on the first day of tracking. */
  expectedOpening: Record<string, number | null>;
  /** Whether the previous day recorded any stock — false means "first day": only Closing + Order needed. */
  hasPreviousStock: boolean;
  totalRevenue: number;
  closingCash: number | null;
}

/** Read-only view for the Stock section (never writes). */
export async function getDailyClosingStockView(
  date: string,
  db: Firestore = defaultFirestore,
  branchId: string = DEFAULT_BRANCH_ID,
): Promise<DailyClosingStockView> {
  if (!isValidDateKey(date)) throw new Error("Invalid date.");
  const [config, snap, prevSnap] = await Promise.all([
    getStockPricingConfig(db),
    getDoc(doc(dailyClosingCollection(db), date)),
    getDoc(doc(dailyClosingCollection(db), previousDateKey(date))),
  ]);
  const day = snap.exists() ? normalizeClosing(snap.data()) : emptyClosing(date, branchId, 0, "manual");
  const prevStock = prevSnap.exists() ? normalizeClosing(prevSnap.data()).stock : [];
  return {
    date,
    locked: day.locked,
    config,
    stock: day.stock,
    shawarmaSold: day.shawarmaSold,
    shawarmaPrices: day.shawarmaPrices,
    estimatedSales: day.estimatedSales,
    expectedOpening: expectedOpeningFromPrevious(prevStock),
    hasPreviousStock: prevStock.some((r) => r.closing !== null),
    totalRevenue: day.totalRevenue,
    closingCash: day.closingCash,
  };
}

export interface UpdateDailyClosingStockInput {
  rows: Array<{ itemId: string; opening?: number | null; closing?: number | null; order?: number | null; mismatchReason?: string | null }>;
  shawarmaSold?: Partial<ShawarmaCounts>;
}

function stockNumber(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be zero or more.`);
  return roundCurrency(n);
}

/**
 * Saves stock rows and shawarma counts, snapshotting today's prices onto the
 * day. Merges: only items present in `rows` change (a row with all three
 * values empty removes that item); other items keep what was saved, so Read
 * from Image can apply just the items it read.
 */
export async function updateDailyClosingStock(
  date: string,
  input: UpdateDailyClosingStockInput,
  db: Firestore = defaultFirestore,
  branchId: string = DEFAULT_BRANCH_ID,
): Promise<FinanceDailyClosing> {
  await assertCanEditDailyClosingDate(date, db, branchId);
  const config = await getStockPricingConfig(db);
  const itemsById = new Map(config.items.map((i) => [i.id, i]));

  // Validate input up front (outside the transaction).
  const updates = new Map<string, DailyClosingStockEntry | null>();
  for (const row of Array.isArray(input.rows) ? input.rows : []) {
    const item = itemsById.get(row.itemId);
    if (!item) continue; // unknown / removed item
    const opening = stockNumber(row.opening, `${item.name} opening`);
    const closing = stockNumber(row.closing, `${item.name} closing`);
    const order = stockNumber(row.order, `${item.name} order`);
    updates.set(
      item.id,
      opening === null && closing === null && order === null
        ? null
        : {
            itemId: item.id,
            itemName: item.name,
            opening,
            closing,
            order,
            unitPrice: item.unitPrice,
            mismatchReason: row.mismatchReason?.trim() ? row.mismatchReason.trim().slice(0, 200) : null,
          },
    );
  }

  return runTransaction(db, async (tx) => {
    const closingRef = doc(dailyClosingCollection(db), date);
    const closingSnap = await tx.get(closingRef);
    const base = await loadOrBootstrapClosingInTx(tx, db, date, branchId, closingSnap);

    // Existing rows (refreshed to today's name/price) + updates, in config order.
    const merged = new Map<string, DailyClosingStockEntry>();
    for (const row of base.stock) {
      const item = itemsById.get(row.itemId);
      if (item) merged.set(row.itemId, { ...row, itemName: item.name, unitPrice: item.unitPrice });
    }
    updates.forEach((row, itemId) => {
      if (row) merged.set(itemId, row);
      else merged.delete(itemId);
    });
    const stock = config.items.filter((i) => merged.has(i.id)).map((i) => merged.get(i.id)!);

    const shawarmaSold = { ...base.shawarmaSold };
    for (const k of SHAWARMA_KINDS) {
      if (input.shawarmaSold && input.shawarmaSold[k.key] !== undefined) {
        shawarmaSold[k.key] = stockNumber(input.shawarmaSold[k.key], k.label) ?? 0;
      }
    }
    const shawarmaPrices = { ...config.shawarmaPrices };
    const next: FinanceDailyClosing = {
      ...base,
      stock,
      shawarmaSold,
      shawarmaPrices,
      estimatedSales: computeEstimatedSales(stock, shawarmaSold, shawarmaPrices),
    };
    tx.set(closingRef, { ...next, createdAt: closingSnap.exists() ? closingSnap.data().createdAt : serverTimestamp(), updatedAt: serverTimestamp() });
    return next;
  });
}
