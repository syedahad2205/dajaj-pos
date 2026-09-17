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

export type FinanceTransactionType = "income" | "expense" | "transfer";
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

  upiSales: number;
  zomatoSales: number;
  swiggySales: number;
  otherIncome: number;

  closingCash: number | null; // manager's physical count
  cashRevenue: number; // closingCash - openingCash + cashExpenseTotal + depositTotal
  totalRevenue: number; // cashRevenue + upiSales + zomatoSales + swiggySales + otherIncome

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
  | "finance_user";

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
 * Posted Transfer rows only. Skips Daily Closing auto-posts, Income,
 * Expense, and voided rows. This is the only amount that may be added
 * to yesterday's locked Closing Cash to get today's Opening Cash.
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
    if (t.type !== "transfer") continue;
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
