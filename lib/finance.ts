import type { Timestamp } from "firebase/firestore";

// ─────────────────────────────────────────────────────────────────────────
// Shared Finance module types + tiny helpers.
// Single source of truth for every money movement in DAJAJ. Kept in lib/
// (not services/) because several finance services need these types without
// importing each other, avoiding circular imports.
// ─────────────────────────────────────────────────────────────────────────

export const DEFAULT_BRANCH_ID = "main";
export const DEFAULT_BRANCH_NAME = "DAJAJ Main";

// "escrow" = money that's been earned but not yet received (e.g. Zomato/Swiggy
// revenue recognized daily via Daily Closing, sitting there until the platform's
// periodic payout actually settles it into a real bank account). Kept distinct
// from "bank" so the Dashboard can tell real cash-in-bank apart from receivables.
export type FinanceAccountType = "cash" | "bank" | "pigmi" | "wallet" | "escrow" | "other";
export type FinanceAccountStatus = "active" | "archived";

export interface FinanceAccount {
  id: string;
  name: string;
  type: FinanceAccountType;
  openingBalance: number;
  currentBalance: number;
  status: FinanceAccountStatus;
  branchId: string;
  description: string;
  displayOrder: number;
  /** Ledger row behind the latest balance change (set by create/void; checked by firestore.rules). */
  lastTransactionId?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface FinanceExpenseCategory {
  id: string;
  name: string;
  active: boolean;
  displayOrder: number;
  icon: string;
  color: string;
  description: string;
  transactionCount: number;
  branchId: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface FinanceExpenseSubcategory {
  id: string;
  categoryId: string;
  categoryName: string;
  name: string;
  active: boolean;
  displayOrder: number;
  transactionCount: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface FinanceIncomeCategory {
  id: string;
  name: string;
  active: boolean;
  displayOrder: number;
  icon: string;
  color: string;
  description: string;
  transactionCount: number;
  branchId: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface FinanceVendor {
  id: string;
  name: string;
  phone: string;
  gstNumber: string;
  address: string;
  notes: string;
  defaultExpenseCategoryId: string | null;
  defaultExpenseCategoryName: string | null;
  active: boolean;
  totalPurchases: number;
  transactionCount: number;
  branchId: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

/**
 * owner_withdrawal — profit taken out of the business (an owner's drawing),
 * split between the owner and the partner. It reduces the source account
 * like any ledger entry, but it is NOT an expense: P&L and the Dashboard
 * only ever sum "income"/"expense", so withdrawals never lower profit.
 */
export type FinanceTransactionType = "income" | "expense" | "transfer" | "owner_withdrawal";

export const OWNER_WITHDRAWAL_OWNER_NAME = "Self (Owner)";
export const OWNER_WITHDRAWAL_PARTNER_NAME = "Juice Lab (Manager)";
export const DEFAULT_OWNER_WITHDRAWAL_PARTNER_PCT = 25;

export interface OwnerWithdrawalSplit {
  ownerName: string;
  ownerAmount: number;
  partnerName: string;
  partnerAmount: number;
  /** Partner's share of this withdrawal, 0–100. */
  partnerPct: number;
}

/** Partner gets partnerPct% (rounded to the paisa); the owner gets exactly the rest, so the two always add up to amount. */
export function splitOwnerWithdrawal(amount: number, partnerPct: number): OwnerWithdrawalSplit {
  const partnerAmount = roundCurrency((amount * partnerPct) / 100);
  return {
    ownerName: OWNER_WITHDRAWAL_OWNER_NAME,
    ownerAmount: roundCurrency(amount - partnerAmount),
    partnerName: OWNER_WITHDRAWAL_PARTNER_NAME,
    partnerAmount,
    partnerPct,
  };
}
export type FinanceTransactionStatus = "posted" | "void";
export type FinancePaymentMethod = "cash" | "upi" | "card" | "bank_transfer" | "cheque" | "other";

export interface FinanceTransaction {
  id: string;
  type: FinanceTransactionType;
  date: string; // YYYY-MM-DD, business date this transaction is booked against
  time: string; // HH:mm, entry time
  categoryId: string | null;
  categoryName: string | null;
  subcategoryId: string | null;
  subcategoryName: string | null;
  description: string;
  amount: number;
  fromAccountId: string | null;
  fromAccountName: string | null;
  toAccountId: string | null;
  toAccountName: string | null;
  vendorId: string | null;
  vendorName: string | null;
  paymentMethod: FinancePaymentMethod | null;
  remarks: string;
  referenceNumber: string;
  status: FinanceTransactionStatus;
  branchId: string;
  createdBy: string;
  createdByName: string;
  // True for any entry generated automatically rather than typed in on the
  // Transactions tab — shows an "Auto" badge in the ledger UI. Account
  // balances update normally either way.
  autoPosted?: boolean;
  // Which automation generated this entry, when autoPosted is true:
  //   "daily_closing"     — Daily Closing's own revenue/deposit postings
  //                          (services/financeClosingService.ts). Their
  //                          amounts are already counted in that day's
  //                          Daily Closing totals, so the Dashboard's
  //                          Monthly Revenue/Expense merge skips these
  //                          specifically to avoid double-counting.
  //   "zomato_settlement" — the Zomato settlement reconciliation's
  //                          Escrow→Bank transfer and deduction/adjustment
  //                          (services/zomatoFinanceService.ts). This is
  //                          genuinely new information (the real gap
  //                          between recognized revenue and what Zomato
  //                          actually paid), so it's NOT excluded from the
  //                          Dashboard merge — it should affect real profit.
  //   "swiggy_settlement" — same idea, for the Swiggy settlement
  //                         reconciliation (services/swiggyFinanceService.ts).
  autoPostedSource?: "daily_closing" | "zomato_settlement" | "swiggy_settlement" | null;
  /** Only on type "owner_withdrawal": who received how much. */
  withdrawalSplit?: OwnerWithdrawalSplit | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  voidedBy?: string | null;
  voidedByName?: string | null;
  voidedAt?: Timestamp | null;
  voidReason?: string | null;
}

/**
 * One cash-expense line inside a day's Daily Closing register. A pure
 * business expense — nothing else. Cash Deposits (Pigmi and friends) are a
 * completely separate concept, see DailyClosingDepositEntry below.
 */
export interface DailyClosingExpenseEntry {
  id: string;
  categoryId: string;
  categoryName: string;
  // Optional second-level breakdown. Stored only when the chosen category has
  // subcategories — keeps historical rows valid even after a subcategory is
  // archived or its parent category is reorganised.
  subcategoryId?: string | null;
  subcategoryName?: string | null;
  amount: number;
  remarks: string;
  createdAt?: Timestamp;
}

/**
 * A cash deposit — money physically leaving the drawer into some other
 * cash holding, but NOT a business expense (it doesn't touch profit).
 * Pigmi is the only type exposed in the UI today, but the shape is
 * deliberately generic so future deposit types (Bank, Petty Cash, Owner
 * Withdrawal, Returned to Safe, ...) slot into the same "Cash Deposits"
 * section without any redesign — just add to CASH_DEPOSIT_TYPES.
 */
export type CashDepositType = "pigmi" | "bank" | "petty_cash" | "owner_withdrawal" | "safe";

export interface DailyClosingDepositEntry {
  id: string;
  type: CashDepositType;
  typeLabel: string; // denormalized display label, kept even if the type catalog changes later
  amount: number;
  remarks: string;
  createdAt?: Timestamp;
}

/**
 * The Daily Closing register — the simplified, single-screen record a
 * manager fills out every night. Fully self-contained: expenses and
 * deposits are embedded (no separate ledger collection to join against),
 * sales are plain manually-entered totals (no bank/account tagging —
 * "settlement happens later"). Opening Cash always chains from the
 * previous locked day's Closing Cash; the only exception is the very first
 * day ever recorded for a branch, which allows a one-time manual value.
 */
export interface FinanceDailyClosing {
  id: string; // = date, YYYY-MM-DD
  date: string;
  branchId: string;

  openingCash: number;
  openingCashSource: "chained" | "manual";
  // Net of THIS day's posted Transfer rows that touch the Cash Drawer
  // (into minus out). Income, Expense, Pigmi, Daily Closing auto-posts,
  // and sales are never included. Formula:
  //   openingCash = yesterday's locked closingCash + externalCashAdjustment
  // Recomputed on Daily Closing GET (unlocked days) and again on Close.
  // After lock, the stored value is frozen — the next day's base is this
  // day's closingCash, not this field.
  externalCashAdjustment: number;

  // Ledger balance of the Cash Drawer as of this locked day AFTER recount.
  // Used only to compute the next close's recount without scanning the
  // whole history. NEVER used as the next day's openingCash.
  cashDrawerBalanceAsOfDate: number | null;

  expenses: DailyClosingExpenseEntry[];
  cashExpenseTotal: number; // sum of expenses[].amount — the real business expense

  deposits: DailyClosingDepositEntry[];
  depositTotal: number; // sum of deposits[].amount (all types) — NOT a business expense

  totalCashOut: number; // cashExpenseTotal + depositTotal

  upiSales: number; // UPI received today, as entered — includes Juice Lab's UPI share
  zomatoSales: number;
  swiggySales: number;
  otherIncome: number;

  // JUICE LAB INVARIANT — see the rules above computeDailyClosingTotals.
  // Juice Lab sells through DAJAJ's till and UPI, but its revenue is not
  // DAJAJ's. Collected = cash Juice Lab took from the drawer (already out of
  // closingCash, so already out of cashRevenue). Pending = the rest, treated
  // as paid to Juice Lab from the UPI account at close, so it comes off UPI.
  juiceLabRevenue: number;
  juiceLabCollected: number;
  juiceLabPending: number; // max(0, juiceLabRevenue − juiceLabCollected)
  upiNetSales: number; // upiSales − juiceLabPending: DAJAJ's own UPI revenue. Can be negative — Juice Lab is paid from the whole UPI account, not just today's UPI.

  closingCash: number | null; // manager's physical count
  cashRevenue: number; // closingCash - openingCash + cashExpenseTotal + depositTotal
  totalRevenue: number; // cashRevenue + upiNetSales + zomatoSales + swiggySales + otherIncome

  locked: boolean;
  closingTime: string | null;
  closedBy: string | null;
  closedByName: string | null;
  reopenCount: number;
  reopenedBy?: string | null;
  reopenedByName?: string | null;
  reopenedAt?: Timestamp | null;
  reopenReason?: string | null;

  // Ledger transaction generated per business event when this day was
  // locked, per the Finance Defaults mapping (see FinanceDefault below).
  // Keyed by eventKey (e.g. "upi_sales") rather than a flat list so a
  // later backfill (see backfillDailyClosingPostings) can tell exactly
  // which events already posted and only retry the ones that didn't,
  // instead of re-posting everything on every touch.
  autoPostedTransactionsByEvent: Record<string, string>;
  // Human-readable notes about any event that couldn't be auto-posted
  // (usually: Finance Defaults isn't configured for it yet). Never blocks
  // saving — the day still closes, the money just isn't in the ledger yet.
  postingWarnings: string[];

  // Daily stock count + shawarmas sold (replaces the old inventory module).
  // Prices are snapshotted onto the day when entered, so changing a price
  // later never rewrites a past day's estimate. estimatedSales is derived
  // (see computeEstimatedSales) and is only an estimate to compare against
  // totalRevenue — it never feeds revenue, the ledger or P&L.
  stock: DailyClosingStockEntry[];
  shawarmaSold: ShawarmaCounts;
  shawarmaPrices: ShawarmaPrices | null;
  estimatedSales: EstimatedSales;

  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

/**
 * Finance Defaults — the single place a business event (Cash Sales, UPI
 * Sales, a Pigmi Deposit, ...) is mapped to the account it should
 * automatically post into. Accounts stay dumb (just balances); Daily
 * Closing stays dumb (just collects numbers); this is what connects them.
 * `eventKey` is stable and code-referenced (e.g. "cash_sales",
 * "upi_sales", "pigmi_deposit" — see depositEventKey()); `eventName` is
 * just the display label and doubles as the income/expense category name
 * used when auto-posting (see getOrCreateIncomeCategoryIdByName).
 */
export interface FinanceDefault {
  id: string; // = eventKey
  eventKey: string;
  eventName: string;
  destinationAccountId: string | null;
  destinationAccountName: string | null;
  description: string;
  isActive: boolean;
  displayOrder: number;
  branchId: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

/** The built-in events tied directly to Daily Closing's fixed fields. Admins can add more (Amazon Pay, MagicPin, ...) for future use without any code change. */
export const BUILT_IN_FINANCE_DEFAULT_EVENTS: Array<{ eventKey: string; eventName: string; description: string }> = [
  { eventKey: "cash_sales", eventName: "Cash Sales", description: "Daily Closing's derived Cash Revenue for the day. Also used as the source account for Cash Deposit transfers below." },
  { eventKey: "upi_sales", eventName: "UPI Sales", description: "Daily Closing's UPI Sales figure." },
  {
    eventKey: "zomato_sales",
    eventName: "Zomato Sales",
    description:
      "Daily Closing's Zomato Sales figure — revenue recognized today, not cash received today. Map this to a Zomato Escrow account, not a bank account. See \"Zomato Settlement Received\" below for the actual bank credit.",
  },
  {
    eventKey: "swiggy_sales",
    eventName: "Swiggy Sales",
    description:
      "Daily Closing's Swiggy Sales figure — revenue recognized today, not cash received today. Map this to a Swiggy Escrow account, not a bank account. See \"Swiggy Settlement Received\" below for the actual bank credit.",
  },
  { eventKey: "other_income", eventName: "Other Income", description: "Daily Closing's Other Income figure." },
  {
    eventKey: "zomato_settlement_received",
    eventName: "Zomato Settlement Received",
    description:
      "The actual bank credit when a Zomato payout settles. Posted automatically by the Zomato module's settlement reconciliation — never by Daily Closing. Map this to the real bank account the payout lands in.",
  },
  {
    eventKey: "swiggy_settlement_received",
    eventName: "Swiggy Settlement Received",
    description: "The actual bank credit when a Swiggy payout settles. Posted by a future Swiggy settlement reconciliation, once that module exists.",
  },
];

/** Event key for a Cash Deposit type (e.g. "pigmi" -> "pigmi_deposit"). Extends automatically as SUPPORTED_CASH_DEPOSIT_TYPES grows. */
export function depositEventKey(type: CashDepositType): string {
  return `${type}_deposit`;
}

export type FinanceAuditModule =
  | "account"
  | "expense_category"
  | "expense_subcategory"
  | "income_category"
  | "vendor"
  | "transaction"
  | "closing"
  | "closing_expense"
  | "closing_deposit"
  | "finance_default"
  | "finance_user"
  | "backup"
  | "stock";

export type FinanceAuditAction =
  | "create"
  | "update"
  | "archive"
  | "restore"
  | "void"
  | "delete"
  | "close"
  | "reopen"
  | "backfill"
  | "disable"
  | "enable"
  | "password_change"
  | "login";

// ─────────────────────────────────────────────────────────────────────────
// Finance Users — a separate, lightweight login intended for the future
// React Native Daily Closing app. Deliberately NOT Firebase Auth and NOT
// the same collection/concept as /admins — a Finance User can only ever
// authenticate against finance_auth via authenticateFinanceUser(), never
// through the DAJAJ web admin login. `role` only has one value today
// (finance_user) but is kept as a field so real roles (cashier, manager,
// owner, auditor, ...) can be introduced later without a schema change.
// ─────────────────────────────────────────────────────────────────────────
export type FinanceUserRole = "finance_user";

export interface FinanceUser {
  id: string;
  fullName: string;
  username: string; // lowercase, unique
  passwordHash: string;
  active: boolean;
  role: FinanceUserRole;
  lastLogin?: Timestamp | null;
  createdBy: string;
  createdByName: string;
  branchId: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

/** Safe-to-expose shape of a FinanceUser — never includes passwordHash. */
export type FinanceUserPublic = Omit<FinanceUser, "passwordHash">;

export function toFinanceUserPublic(user: FinanceUser): FinanceUserPublic {
  const { passwordHash, ...rest } = user;
  return rest;
}

export interface FinanceAuditLog {
  id: string;
  module: FinanceAuditModule;
  entityId: string;
  entityLabel: string;
  action: FinanceAuditAction;
  userId: string;
  userName: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
  timestamp?: Timestamp;
}

/** YYYY-MM-DD for the given date, in the server/browser's local time. */
export function toDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** HH:mm for the given date, in the server/browser's local time. */
export function toTimeKey(date: Date = new Date()): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/** Yesterday's date key relative to a given YYYY-MM-DD date key. */
export function previousDateKey(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() - 1);
  return toDateKey(d);
}

/** Tomorrow's date key relative to a given YYYY-MM-DD date key — used to walk forward through the Opening Cash chain. */
export function nextDateKey(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return toDateKey(d);
}

/**
 * The only date Daily Closing may open/edit: the day after the most recent
 * locked closing (so Opening Cash always exists). Caps at `today` after
 * today's close. With no locked day yet, that's today (first closing).
 */
export function dailyClosingWorkDate(latestLockedDate: string | null, today: string): string {
  if (!latestLockedDate) return today;
  const next = nextDateKey(latestLockedDate);
  return next > today ? today : next;
}

export function canEditDailyClosingDate(date: string, latestLockedDate: string | null, today: string): boolean {
  if (!isValidDateKey(date) || date > today) return false;
  return date === dailyClosingWorkDate(latestLockedDate, today);
}

export class ClosingSequenceError extends Error {
  workDate: string;
  latestLockedDate: string | null;

  constructor(workDate: string, latestLockedDate: string | null) {
    const message = latestLockedDate
      ? `Daily Closing can only be done for ${workDate}, the day after the last closed date (${latestLockedDate}). Close days in order so opening cash exists.`
      : `Daily Closing can only be started for ${workDate}.`;
    super(message);
    this.name = "ClosingSequenceError";
    this.workDate = workDate;
    this.latestLockedDate = latestLockedDate;
  }
}

export function isValidDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Net Cash Drawer Transfers for a set of ledger rows:
 *   transfers INTO the drawer − transfers OUT OF the drawer.
 * Posted Transfer and Owner Withdrawal rows only (cash taken from the till
 * as profit must not read as lower Cash Sales at close). Skips Daily
 * Closing auto-posts, Income, Expense, and voided rows. This is the only
 * amount that may be added to yesterday's locked Closing Cash to get
 * today's Opening Cash.
 */
export function netCashDrawerTransferAdjustment(
  transactions: Array<{
    type: string;
    amount: number;
    status?: string | null;
    autoPostedSource?: string | null;
    fromAccountId?: string | null;
    toAccountId?: string | null;
  }>,
  cashDrawerAccountId: string,
): number {
  let delta = 0;
  for (const t of transactions) {
    if (t.status && t.status !== "posted") continue;
    if (t.autoPostedSource === "daily_closing") continue;
    if (t.type !== "transfer" && t.type !== "owner_withdrawal") continue;
    if (t.toAccountId === cashDrawerAccountId) delta += t.amount;
    if (t.fromAccountId === cashDrawerAccountId) delta -= t.amount;
  }
  return roundCurrency(delta);
}

/** openingCash = yesterday's locked closingCash + net same-day Cash Drawer Transfers. */
export function openingCashFromPrevClosingAndTransfers(prevLockedClosingCash: number, netTransfers: number): number {
  return roundCurrency(prevLockedClosingCash + netTransfers);
}

/**
 * P&L / dashboard "is this the till?" check. Daily Closing already owns
 * the physical cash drawer, so ledger expenses/income on THAT account are
 * skipped to avoid double-counting. Pigmi/Unity (and any other holding
 * account) must still count even if someone typed the account as "cash" —
 * collecting Pigmi is profit via Daily Closing cash sales; paying salary
 * from Pigmi is a real expense.
 *
 * When Cash Sales has a mapped destination, only that account is the
 * drawer. If it isn't mapped yet, fall back to `type === "cash"`.
 */
export function isPnlCashDrawerAccount(
  accountId: string | null | undefined,
  cashDrawerAccountId: string | null | undefined,
  accountTypeById: Map<string, string>,
): boolean {
  if (!accountId) return false;
  if (cashDrawerAccountId) return accountId === cashDrawerAccountId;
  return accountTypeById.get(accountId) === "cash";
}

/** Display label for every known deposit type, including ones not yet exposed in the UI. */
export const CASH_DEPOSIT_TYPE_LABELS: Record<CashDepositType, string> = {
  pigmi: "Pigmi",
  bank: "Bank Deposit",
  petty_cash: "Petty Cash",
  owner_withdrawal: "Owner Withdrawal",
  safe: "Returned to Safe",
};

/** Deposit types actually offered on the Daily Closing screen today. Extend this array (no UI redesign needed) to add more. */
export const SUPPORTED_CASH_DEPOSIT_TYPES: CashDepositType[] = ["pigmi"];

/** Short unique id for embedded array items (expense entry lines) that don't get their own Firestore doc. */
export function generateLocalId(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === "function") return webCrypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Daily Closing math + "what counts toward P&L" — pure functions shared by
// services/financeClosingService.ts, the Dashboard, the P&L report and the
// AI Assistant, and exercised directly by scripts/verify-juice-lab.ts.
//
// JUICE LAB INVARIANT — read before changing any revenue/UPI/P&L math.
// Juice Lab sells through DAJAJ's till and UPI account, but its money is
// NEVER DAJAJ revenue, expense or profit. The rules, and why they hold:
//
//   1. Collected (cash Juice Lab takes from the drawer) is NOT subtracted
//      anywhere. It physically left the drawer before the count, so
//      closingCash — and therefore cashRevenue — already excludes it.
//      Subtracting it again would double-count.
//   2. Pending (= revenue − collected) is paid to Juice Lab out of the UPI
//      account, so DAJAJ's UPI revenue is upiNetSales = upiSales − pending.
//      It MAY be negative: Juice Lab is paid from the whole UPI balance, not
//      just that day's UPI. Never clamp it and never block closing on it.
//   3. totalRevenue uses upiNetSales, never upiSales. Every revenue figure
//      (Daily Closing, Dashboard, P&L, AI Assistant, mobile history) must
//      read totalRevenue or upiNetSales — never the raw upiSales.
//   4. Ledger: "UPI Sales" posts the FULL upiSales (real money in) and
//      "Juice Lab Payout" posts pending out of the UPI account. Both are
//      autoPostedSource "daily_closing", which pnlLedgerTransactions skips,
//      so neither ever counts as revenue/expense. Keep that tag.
//   5. Result, for any split: totalRevenue = DAJAJ's own cash + UPI sales.
//      (The cash-vs-UPI breakdown can shift by Juice Lab's UPI share, since
//      the sheet doesn't say how Juice Lab's customers paid; the total can't.)
//
// Every place that depends on this is tagged "JUICE LAB INVARIANT" — grep it.
// After any change here, run scripts/verify-juice-lab.ts (compile with tsc
// like scripts/verify-opening-cash-rule.ts) and make sure every case passes.
// ─────────────────────────────────────────────────────────────────────────

/**
 * A day's derived totals. Juice Lab: collected cash already left the drawer
 * (so it's already out of cashRevenue); the pending part is paid out of UPI,
 * so only upiNetSales (UPI − pending) is DAJAJ revenue.
 *
 * JUICE LAB INVARIANT (rules 1–3 above): don't subtract collected from cash,
 * don't clamp upiNetSales at 0, and keep totalRevenue on upiNetSales.
 * Daily Closing's live preview (app/admin/finance/closing/page.tsx) mirrors
 * this formula — change both together.
 */
export function computeDailyClosingTotals(input: {
  openingCash: number;
  expenses: DailyClosingExpenseEntry[];
  deposits: DailyClosingDepositEntry[];
  upiSales: number;
  zomatoSales: number;
  swiggySales: number;
  otherIncome: number;
  juiceLabRevenue?: number;
  juiceLabCollected?: number;
  closingCash: number | null;
}) {
  const cashExpenseTotal = roundCurrency(input.expenses.reduce((sum, e) => sum + e.amount, 0));
  const depositTotal = roundCurrency(input.deposits.reduce((sum, d) => sum + d.amount, 0));
  const totalCashOut = roundCurrency(cashExpenseTotal + depositTotal);

  // JUICE LAB INVARIANT: collected cash already left the drawer (so it's
  // already out of cashRevenue below); only the pending part comes off UPI.
  const juiceLabPending = roundCurrency(Math.max(0, (input.juiceLabRevenue ?? 0) - (input.juiceLabCollected ?? 0)));
  const upiNetSales = roundCurrency(input.upiSales - juiceLabPending);

  let cashRevenue = 0;
  let totalRevenue = 0;
  if (input.closingCash !== null) {
    cashRevenue = roundCurrency(input.closingCash - input.openingCash + cashExpenseTotal + depositTotal);
    totalRevenue = roundCurrency(cashRevenue + upiNetSales + input.zomatoSales + input.swiggySales + input.otherIncome);
  }

  return { cashExpenseTotal, depositTotal, totalCashOut, cashRevenue, totalRevenue, juiceLabPending, upiNetSales };
}

/**
 * The ledger postings a closed day should generate (amount > 0 only).
 * UPI Sales posts everything that landed in the UPI account; Juice Lab's
 * pending share leaves it again as "Juice Lab Payout". All of these are
 * tagged autoPostedSource "daily_closing" and are skipped by
 * pnlLedgerTransactions — revenue/profit come from the day's totals instead.
 */
export function dailyClosingPostingEvents(
  closing: FinanceDailyClosing,
): Array<{ eventKey: string; eventName: string; amount: number; kind: "income" | "expense" | "deposit" }> {
  const incomeEvents = [
    { eventKey: "cash_sales", eventName: "Cash Sales", amount: closing.cashRevenue, kind: "income" as const },
    // JUICE LAB INVARIANT (rule 4): the FULL upiSales — what actually landed in
    // the UPI account. Do NOT switch this to upiNetSales: Juice Lab's pending
    // share leaves the account as a separate "Juice Lab Payout" below, and
    // upiNetSales can be negative (an income posting can't be).
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
  //
  // Juice Lab Payout — JUICE LAB INVARIANT (rule 4): Juice Lab's pending
  // share, paid out of the UPI account (the whole account — it may be more
  // than today's UPI Sales). It's typed "expense" only so the UPI balance
  // drops; like every Daily Closing auto-post it's skipped by
  // pnlLedgerTransactions, so it is never counted as a business expense.
  const expenseEvents = [
    { eventKey: "cash_expenses", eventName: "Cash Expenses", amount: closing.cashExpenseTotal, kind: "expense" as const },
    { eventKey: "juice_lab_payout", eventName: "Juice Lab Payout", amount: closing.juiceLabPending, kind: "expense" as const },
  ].filter((e) => e.amount > 0);

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
 * The only ledger rows that count toward revenue/expense on the Dashboard,
 * P&L and AI Assistant. Skips Daily Closing's own auto-posts (their amounts
 * are already in the day's totals — including UPI Sales and Juice Lab
 * Payout) and anything on the cash drawer (Daily Closing owns the till).
 * Transfers and Owner Withdrawals are never income or expense.
 *
 * JUICE LAB INVARIANT (rule 4): the "daily_closing" filter is what keeps
 * UPI Sales (posted gross) and Juice Lab Payout out of revenue/expense —
 * never remove or loosen it. Use this function rather than re-writing the
 * filter; the Dashboard, P&L and AI Assistant all call it.
 */
export function pnlLedgerTransactions<
  T extends { type: string; autoPostedSource?: string | null; fromAccountId: string | null; toAccountId: string | null },
>(transactions: T[], isCashDrawer: (accountId: string | null) => boolean): { income: T[]; expense: T[] } {
  const relevant = transactions.filter((t) => t.autoPostedSource !== "daily_closing");
  return {
    income: relevant.filter((t) => t.type === "income" && !isCashDrawer(t.toAccountId)),
    expense: relevant.filter((t) => t.type === "expense" && !isCashDrawer(t.fromAccountId)),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Daily stock + estimated sales (Daily Closing "Stock" section)
//
// Each day records, per stock item: Opening (start of day), Closing (left at
// the end of the day) and Order (arriving for the next day). The chain rule:
// today's Opening must equal yesterday's Closing + Order — Daily Closing
// pre-fills it and refuses to close a day where it differs without a reason
// (spoilage, short delivery, …). The very first day has no previous count, so
// only Closing + Order are needed.
//
// Estimated sales = Σ (Opening − Closing) × item price + Σ shawarmas × price.
// It is ONLY a cross-check against the day's Total Revenue; it never feeds
// revenue, the ledger or P&L. Prices live in finance_stock_config/main and
// are copied onto each day when its stock is saved.
// ─────────────────────────────────────────────────────────────────────────

export interface StockItemConfig {
  id: string;
  name: string;
  /** ₹ per piece. null = price not set yet (left out of the estimate, flagged in the UI). */
  unitPrice: number | null;
  active: boolean;
  displayOrder: number;
}

export interface ShawarmaPrices {
  khubbusRoll: number;
  khubbusPlate: number;
  rumaliRoll: number;
  rumaliPlate: number;
}

export type ShawarmaCounts = ShawarmaPrices;

/** A staff member on the sheet's "A. FIXED EXPENSES (Salary)" rows. A ticked PAID box with no amount uses dailySalary. */
export interface StaffSalaryConfig {
  id: string;
  name: string;
  /** ₹ per day. null = not set yet (a ticked row then needs the amount typed in during review). */
  dailySalary: number | null;
  active: boolean;
}

/** Stored in finance_stock_config/main (Admin edits, Finance Manager reads). */
export interface StockPricingConfig {
  items: StockItemConfig[];
  shawarmaPrices: ShawarmaPrices;
  staff: StaffSalaryConfig[];
}

export const SHAWARMA_KINDS: Array<{ key: keyof ShawarmaPrices; label: string }> = [
  { key: "khubbusRoll", label: "Khubbus Roll" },
  { key: "khubbusPlate", label: "Khubbus Plate" },
  { key: "rumaliRoll", label: "Rumali Roll" },
  { key: "rumaliPlate", label: "Rumali Plate" },
];

export const EMPTY_SHAWARMA_COUNTS: ShawarmaCounts = { khubbusRoll: 0, khubbusPlate: 0, rumaliRoll: 0, rumaliPlate: 0 };

export const DEFAULT_STOCK_PRICING: StockPricingConfig = {
  items: [
    { id: "alfaham", name: "Alfaham", unitPrice: 480, active: true, displayOrder: 1 },
    { id: "grill", name: "Grill", unitPrice: 480, active: true, displayOrder: 2 },
    { id: "tandoori", name: "Tandoori", unitPrice: 480, active: true, displayOrder: 3 },
    { id: "tikka", name: "Tikka", unitPrice: 80, active: true, displayOrder: 4 },
    { id: "tandoori_kebab", name: "Tandoori Kebab", unitPrice: 100, active: true, displayOrder: 5 },
    { id: "boneless", name: "Boneless", unitPrice: null, active: true, displayOrder: 6 },
  ],
  shawarmaPrices: { khubbusRoll: 60, khubbusPlate: 100, rumaliRoll: 80, rumaliPlate: 140 },
  staff: [
    { id: "sahil", name: "Sahil", dailySalary: null, active: true },
    { id: "anees", name: "Anees", dailySalary: null, active: true },
    { id: "shaban", name: "Shaban", dailySalary: null, active: true },
  ],
};

export interface DailyClosingStockEntry {
  itemId: string;
  itemName: string;
  /** null on the first day of tracking (no previous count to chain from). */
  opening: number | null;
  closing: number | null;
  order: number | null;
  /** Price snapshot at the time this day's stock was saved. */
  unitPrice: number | null;
  /** Required when Opening ≠ previous day's Closing + Order. */
  mismatchReason?: string | null;
}

export interface EstimatedSalesLine {
  itemId: string;
  itemName: string;
  sold: number;
  unitPrice: number | null;
  amount: number;
}

export interface EstimatedSales {
  lines: EstimatedSalesLine[];
  stockTotal: number;
  shawarmaTotal: number;
  total: number;
  /** Items with a count but no price — not included in total. */
  unpricedItems: string[];
  /** Items whose Closing is more than Opening — sold treated as 0. */
  negativeItems: string[];
}

/** Pure. Sold = Opening − Closing (only when both are known); never negative. */
export function computeEstimatedSales(
  stock: DailyClosingStockEntry[],
  shawarmaSold: ShawarmaCounts,
  shawarmaPrices: ShawarmaPrices | null,
): EstimatedSales {
  const lines: EstimatedSalesLine[] = [];
  const unpricedItems: string[] = [];
  const negativeItems: string[] = [];
  for (const row of stock) {
    if (row.opening === null || row.closing === null) continue;
    const rawSold = roundCurrency(row.opening - row.closing);
    if (rawSold < 0) negativeItems.push(row.itemName);
    const sold = Math.max(0, rawSold);
    if (sold > 0 && row.unitPrice === null) unpricedItems.push(row.itemName);
    lines.push({ itemId: row.itemId, itemName: row.itemName, sold, unitPrice: row.unitPrice, amount: roundCurrency(sold * (row.unitPrice ?? 0)) });
  }
  const stockTotal = roundCurrency(lines.reduce((sum, l) => sum + l.amount, 0));
  const shawarmaTotal = shawarmaPrices
    ? roundCurrency(SHAWARMA_KINDS.reduce((sum, k) => sum + (shawarmaSold[k.key] ?? 0) * shawarmaPrices[k.key], 0))
    : 0;
  return { lines, stockTotal, shawarmaTotal, total: roundCurrency(stockTotal + shawarmaTotal), unpricedItems, negativeItems };
}

/** What today's Opening should be per item: previous day's Closing + Order (null when the previous day didn't count it). */
export function expectedOpeningFromPrevious(previousStock: DailyClosingStockEntry[] | null | undefined): Record<string, number | null> {
  const expected: Record<string, number | null> = {};
  for (const row of previousStock ?? []) {
    expected[row.itemId] = row.closing === null ? null : roundCurrency(row.closing + (row.order ?? 0));
  }
  return expected;
}

/**
 * Zomato/Swiggy sales are priced above DAJAJ's own menu, so Daily Closing's
 * stock check takes a flat AGGREGATOR_MARKUP_PCT off them (₹1,300 → ₹910)
 * before comparing with the stock-based estimate, which uses menu prices.
 * A flat percentage off, as decided by the owner — not ÷ 1.30. Display-only:
 * never used for revenue, the ledger, P&L or Reports.
 */
export const AGGREGATOR_MARKUP_PCT = 30;

/** Revenue with Zomato/Swiggy sales reduced by a flat AGGREGATOR_MARKUP_PCT (platform sales × 0.70). */
export function revenueAtMenuPrices(totalRevenue: number, zomatoSales: number, swiggySales: number): { comparable: number; markupRemoved: number } {
  const platform = (zomatoSales || 0) + (swiggySales || 0);
  const atMenu = roundCurrency(platform * (1 - AGGREGATOR_MARKUP_PCT / 100));
  const markupRemoved = roundCurrency(platform - atMenu);
  return { comparable: roundCurrency(totalRevenue - markupRemoved), markupRemoved };
}

/** Rows whose Opening differs from the expected chain value and have no reason yet. */
export function unexplainedStockMismatches(
  stock: DailyClosingStockEntry[],
  expected: Record<string, number | null>,
): Array<{ itemName: string; opening: number; expected: number }> {
  const out: Array<{ itemName: string; opening: number; expected: number }> = [];
  for (const row of stock) {
    const exp = expected[row.itemId];
    if (exp === null || exp === undefined || row.opening === null) continue;
    if (Math.abs(row.opening - exp) > 0.001 && !row.mismatchReason?.trim()) out.push({ itemName: row.itemName, opening: row.opening, expected: exp });
  }
  return out;
}
