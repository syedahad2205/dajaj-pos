/**
 * Type-only mirror of the relevant shapes from lib/finance.ts (web project).
 *
 * RULES for this file (enforced by design §9 / Requirement 6.1):
 *   - Field names, types, and optionality MUST be identical to lib/finance.ts.
 *     Do not rename, reorder, retype, or change optionality of any field.
 *   - No logic, no computed values, no derived fields.
 *   - When lib/finance.ts changes any of these interfaces, update here to match.
 *   - `Timestamp` from firebase/firestore is not available in the RN bundle;
 *     we accept `any` for optional timestamp fields that are only used for
 *     informational display, never for business logic.
 *
 * Source: /dajaj-pos/lib/finance.ts
 */

// Using `any` for Firestore Timestamp fields — these arrive from the server as
// serialized values and are only used for display, never for business logic.
 
type FirestoreTimestamp = any;

// ─── Re-exported from constants/finance.ts (single source within mobile) ────
export type { CashDepositType } from '@/constants/finance';

// ─── DailyClosingExpenseEntry ─────────────────────────────────────────────────
export interface DailyClosingExpenseEntry {
  id: string;
  categoryId: string;
  categoryName: string;
  // Optional second-level breakdown. Mirrors lib/finance.ts — stored only when
  // the chosen category has subcategories.
  subcategoryId?: string | null;
  subcategoryName?: string | null;
  amount: number;
  remarks: string;
  createdAt?: FirestoreTimestamp;
}

// ─── FinanceExpenseSubcategory ────────────────────────────────────────────────
export interface FinanceExpenseSubcategory {
  id: string;
  categoryId: string;
  categoryName: string;
  name: string;
  active: boolean;
  displayOrder: number;
  transactionCount: number;
  createdAt?: FirestoreTimestamp;
  updatedAt?: FirestoreTimestamp;
}

// ─── DailyClosingDepositEntry ─────────────────────────────────────────────────
export interface DailyClosingDepositEntry {
  id: string;
  type: import('@/constants/finance').CashDepositType;
  typeLabel: string;
  amount: number;
  remarks: string;
  createdAt?: FirestoreTimestamp;
}

// ─── FinanceDailyClosing ──────────────────────────────────────────────────────
export interface FinanceDailyClosing {
  id: string; // = date, YYYY-MM-DD
  date: string;
  branchId: string;

  openingCash: number;
  openingCashSource: 'chained' | 'manual';

  expenses: DailyClosingExpenseEntry[];
  cashExpenseTotal: number;

  deposits: DailyClosingDepositEntry[];
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
  closedBy: string | null;
  closedByName: string | null;
  reopenCount: number;
  reopenedBy?: string | null;
  reopenedByName?: string | null;
  reopenedAt?: FirestoreTimestamp | null;
  reopenReason?: string | null;

  autoPostedTransactionsByEvent: Record<string, string>;
  postingWarnings: string[];

  createdAt?: FirestoreTimestamp;
  updatedAt?: FirestoreTimestamp;
}

// ─── FinanceExpenseCategory ───────────────────────────────────────────────────
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
  createdAt?: FirestoreTimestamp;
  updatedAt?: FirestoreTimestamp;
}

// ─── FinanceDefault ───────────────────────────────────────────────────────────
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
  createdAt?: FirestoreTimestamp;
  updatedAt?: FirestoreTimestamp;
}

// ─── FinanceUserPublic ────────────────────────────────────────────────────────
// Legacy finance_auth user shape (username/password login — no longer used by
// the app's login flow, kept for reference).
export interface FinanceUserPublic {
  id: string;
  fullName: string;
  username: string;
  active: boolean;
  role: 'finance_user';
  lastLogin?: FirestoreTimestamp | null;
  createdBy: string;
  createdByName: string;
  branchId: string;
  createdAt?: FirestoreTimestamp;
  updatedAt?: FirestoreTimestamp;
}

// ─── MobileIdentity ───────────────────────────────────────────────────────────
// The signed-in identity for the app — a Firebase Auth account with finance
// access, resolved via GET /api/mobile/v1/finance/auth/whoami.
export interface MobileIdentity {
  uid: string;
  role: 'admin' | 'financeManager';
  fullName: string;
  email: string | null;
}
