import type { Timestamp } from "firebase/firestore";
import type { CashDepositType, FinanceTransactionType } from "@/lib/finance";

// ─────────────────────────────────────────────────────────────────────────
// AI Assistant chat — shared types.
//
// This is a conversational front door onto the SAME two write paths every
// other Finance AI feature already uses: services/financeClosingService.ts
// (addDailyClosingExpense / addDailyClosingDeposit / updateDailyClosingSales
// / closeDailyClosing) and services/financeTransactionsService.ts
// (createFinanceTransaction). It introduces no new ledger, no new balance
// math, and no new category/account list. The AI only ever proposes
// structured "actions" from a chat turn (text + 0..N images) — nothing is
// written to fin_daily_closing/fin_transactions until an admin explicitly
// approves that specific action, one at a time, from the review UI.
//
// Admin-only for now (see firestore.rules — this collection is gated to
// isAdmin(), unlike most fin_*/quick_entry_* collections which also allow
// Finance Manager). Screenshots themselves are never stored — sent to
// Gemini for analysis, then discarded — same privacy stance Quick Entry
// already takes (see services/quickEntryService.ts's file header).
// ─────────────────────────────────────────────────────────────────────────

export const FINANCE_AI_CHAT_COLLECTION = "finance_ai_chat_messages";

// "Clear chat" is non-destructive by design — same "archive, don't delete"
// principle as the rest of this Finance module (categories/accounts are
// archived, never deleted, once they have history against them). Clearing
// just moves a per-branch cursor forward; getFinanceAiChatHistory hides any
// message at or before it, but every message doc (and the real, audited
// Daily Closing/transaction writes any approved action produced) stays in
// Firestore forever. One doc per branchId, keyed by branchId itself.
export const FINANCE_AI_CHAT_SETTINGS_COLLECTION = "finance_ai_chat_settings";

export interface FinanceAiChatSettings {
  branchId: string;
  clearedBefore?: Timestamp;
  clearedBy?: string;
  clearedByName?: string;
}

export type FinanceAiChatRole = "user" | "assistant";

/** What kind of write an approved action performs. */
export type FinanceAiActionKind = "daily_closing_field" | "transaction";

export type FinanceAiActionStatus = "pending" | "approved" | "discarded" | "failed";

/**
 * Which part of a Daily Closing day this action touches.
 * "expense"/"deposit" ADD a new line item (mirrors addDailyClosingExpense/
 * addDailyClosingDeposit — never overwrites existing lines). The scalar
 * fields SET/overwrite that field's value for the day (mirrors
 * updateDailyClosingSales). "closingCash" is different from all of these —
 * it CLOSES AND LOCKS the day (there is no draft-only way to set Closing
 * Cash; closeDailyClosing is the only function that writes it), so the
 * review UI must make that consequence unmistakable before an admin
 * approves it.
 */
export type FinanceAiDailyClosingField =
  | "closingCash"
  | "upiSales"
  | "zomatoSales"
  | "swiggySales"
  | "otherIncome"
  | "expense"
  | "deposit";

/** Resolved (backend-validated) payload for a daily_closing_field action. `date` is ALWAYS the final, already-adjusted attribution date (e.g. a UPI settlement screenshot dated "27 Aug 5:30 AM" resolves to 26 Aug here, per the T+1 settlement rule) — never a raw screenshot timestamp. */
export interface FinanceAiDailyClosingPayload {
  date: string; // YYYY-MM-DD
  field: FinanceAiDailyClosingField;
  /** Set for closingCash/upiSales/zomatoSales/swiggySales/otherIncome only. */
  value: number | null;
  /** Set for field === "expense" only. categoryId is null if no existing category (deterministic, AI-guess, or Misc-style fallback) could be resolved — the admin must pick one before this action can be approved. */
  expenseCategoryId: string | null;
  expenseCategoryName: string | null;
  expenseAmount: number | null;
  expenseRemarks: string;
  /** Set for field === "deposit" only. */
  depositType: CashDepositType | null;
  depositAmount: number | null;
  depositRemarks: string;
}

/** Resolved (backend-validated) payload for a transaction action — mirrors CreateFinanceTransactionInput's required shape per type (see financeTransactionsService.ts's validateInput). Account/category NAMES are what the AI actually sees/guesses; IDs here are the backend's resolution of those names against the real, existing lists — never invented. */
export interface FinanceAiTransactionPayload {
  type: FinanceTransactionType;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  amount: number;
  /** Expense category id (type "expense") or income category id (type "income"). Always null for "transfer". */
  categoryId: string | null;
  categoryName: string | null;
  fromAccountId: string | null;
  fromAccountName: string | null;
  toAccountId: string | null;
  toAccountName: string | null;
  remarks: string;
  referenceNumber: string;
}

/** How confident the source match was — surfaced in the review UI so an unresolved/guessed field is visually distinct from a confident one, same idea as DailyClosingCategoryMatchSource in lib/dailyClosingImage.ts. */
export type FinanceAiMatchSource = "deterministic" | "ai" | "misc_fallback" | null;

export interface FinanceAiProposedAction {
  id: string;
  kind: FinanceAiActionKind;
  /** Which uploaded image (0-based, in the order sent) this action was derived from — null if it came from the typed text alone. */
  sourceImageIndex: number | null;
  /** One-line, human-readable explanation of what the AI saw and why it proposed this — e.g. "UPI settlement screenshot shows 27 Aug 5:30 AM settlement → attributed to 26 Aug (UPI settles next-day morning)." Always shown in the review UI, never hidden. */
  reasoning: string;
  /** The AI's own 0..1 confidence for this specific action. */
  confidence: number;
  categorySource: FinanceAiMatchSource;
  accountSource: FinanceAiMatchSource;
  dailyClosing: FinanceAiDailyClosingPayload | null;
  transaction: FinanceAiTransactionPayload | null;
  status: FinanceAiActionStatus;
  /** Set once approved: the Daily Closing date (for daily_closing_field) or the fin_transactions id (for transaction) this action produced. */
  resultRef: string | null;
  errorMessage: string | null;
  /** Extra context to show alongside a resolved action — e.g. "26 Aug 2026 was already closed — reopened, corrected, and re-closed." Set when approving a daily_closing_field action required transparently reopening an already-locked day (a real, audited reopen — see resolveFinanceAiAction — not a silent edit). Null otherwise. */
  resolvedNote: string | null;
  resolvedAt?: Timestamp | null;
  resolvedBy?: string | null;
  resolvedByName?: string | null;
}

export interface FinanceAiChatMessage {
  id: string;
  role: FinanceAiChatRole;
  /** The admin's typed text (role "user") or the AI's natural-language reply (role "assistant"). */
  text: string;
  /** How many images were attached to this turn — the images themselves are never persisted (see file header). Always 0 for role "assistant". */
  imageCount: number;
  /** Only ever populated for role "assistant". */
  proposedActions: FinanceAiProposedAction[];
  branchId: string;
  createdBy: string;
  createdByName: string;
  createdAt?: Timestamp;
}

/** Client → server input for one chat turn. */
export interface FinanceAiChatImageInput {
  base64Data: string;
  mimeType: string;
}
