import type { Timestamp } from "firebase/firestore";

// ─────────────────────────────────────────────────────────────────────────
// Quick Entry — shared types + tiny helpers.
//
// Quick Entry is a NEW front-facing workflow ("upload a payment screenshot,
// let AI read it, review, save") that ends by calling the EXISTING finance
// transaction creation mechanism (services/financeTransactionsService.ts →
// createFinanceTransaction, the exact function the Transactions tab already
// uses). It does not introduce a parallel ledger, account list, or category
// list — see lib/finance.ts for those, unchanged.
//
// The only genuinely new persisted state Quick Entry needs, that doesn't
// already exist anywhere else in the app:
//   1. QuickEntryPayeeRule  — payee text → expense category mapping, so
//      "Fayeeq MH" always becomes "Chicken Expense" etc. Configurable so
//      more rules (gas, electricity, ...) can be added later without a
//      code change. Lives in its own collection (quick_entry_payee_rules),
//      independent of fin_expense_categories.
//   2. QuickEntryRecord     — links the raw AI extraction to the real
//      transaction id that Quick Entry created via the existing
//      mechanism. Lives in its own collection (quick_entry_records), keyed
//      by that transaction's id. fin_transactions itself is never
//      touched. By explicit request, the payment screenshot itself is
//      NOT stored anywhere (sent to the AI for extraction, then
//      discarded) — spec §15's screenshot-retention step was deliberately
//      skipped for this build.
//   3. QuickEntryActivityLog — Quick-Entry-specific action log (screenshot
//      uploaded/analysed, duplicate warning shown, transaction viewed/
//      cancelled, category/account changed, AI/creation failures, ...).
//      The transaction creation itself is already captured by the
//      existing fin_audit_logs trail for free (createFinanceTransaction
//      writes it automatically) — this collection only covers the Quick
//      Entry UX events that trail has no vocabulary for, without touching
//      fin_audit_logs or its (Admin-only) read rule.
// ─────────────────────────────────────────────────────────────────────────

export const QUICK_ENTRY_SOURCE = "quick_entry" as const;

/** Structured JSON we ask the AI vision model for. Untrusted input — every field is validated/re-typed on the backend before it can influence a transaction. */
export interface AIExtractedPayment {
  amount: number | null;
  currency: string | null;
  date: string | null; // YYYY-MM-DD if the AI could read one
  time: string | null; // HH:mm
  status: "success" | "failed" | "pending" | "unknown";
  paymentMethod: "upi" | "card" | "bank_transfer" | "cash" | "cheque" | "other" | null;
  bankName: string | null;
  accountIdentifier: string | null; // last 4 digits / masked account, if visible
  payee: string | null;
  referenceNumber: string | null; // UTR / transaction id
  notes: string | null; // anything else useful the AI noticed
  /** AI's free-text guess at an expense category name (spec §9's "AI suggestion" step). Only ever used by the backend if it fuzzy-matches an EXISTING category name — otherwise ignored entirely. The AI never creates a category. */
  suggestedCategory: string | null;
  confidence: number; // 0..1, AI's own estimate
  readable: boolean; // false if the screenshot wasn't legible / wasn't a payment at all
}

/** A safe "nothing extracted" fallback — used when the AI call fails outright, so the review screen can still open in manual-entry mode instead of erroring out. */
export const EMPTY_AI_EXTRACTION: AIExtractedPayment = {
  amount: null,
  currency: null,
  date: null,
  time: null,
  status: "unknown",
  paymentMethod: null,
  bankName: null,
  accountIdentifier: null,
  payee: null,
  referenceNumber: null,
  notes: null,
  suggestedCategory: null,
  confidence: 0,
  readable: false,
};

export interface QuickEntryPayeeRule {
  id: string;
  /** Normalized (lowercase, punctuation/space-collapsed) match key — see normalizePayeeText() below. */
  matchKey: string;
  /** Original human-entered payee text this rule was created for, kept for display in Settings. */
  payeeLabel: string;
  categoryId: string;
  categoryName: string;
  active: boolean;
  branchId: string;
  createdBy: string;
  createdByName: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface QuickEntryRecord {
  id: string; // = the fin_transactions id it's attached to
  transactionId: string;
  aiExtracted: AIExtractedPayment;
  matchedPayeeRuleId: string | null;
  duplicateWarningShown: boolean;
  duplicateOverridden: boolean;
  branchId: string;
  createdBy: string;
  createdByName: string;
  createdAt?: Timestamp;
}

export type QuickEntryActivityAction =
  | "login"
  | "logout"
  | "screenshot_uploaded"
  | "screenshot_analyzed"
  | "ai_unavailable"
  | "transaction_created"
  | "transaction_creation_failed"
  | "transaction_viewed"
  | "transaction_cancelled"
  | "category_changed"
  | "account_changed"
  | "duplicate_warning_shown"
  | "duplicate_confirmed"
  | "auth_failure";

/**
 * Actions the CLIENT is allowed to self-report via POST /api/finance/quick-entry/activity.
 * Everything else in QuickEntryActivityAction (screenshot_uploaded/analyzed,
 * duplicate_warning_shown, transaction_created/creation_failed,
 * duplicate_confirmed, ai_unavailable) is written by the server itself,
 * inside services/quickEntryService.ts, at the moment it actually happens —
 * letting the client also write those would let a caller log a fake
 * "transaction_created" that never really happened.
 */
export const CLIENT_LOGGABLE_QUICK_ENTRY_ACTIONS: readonly QuickEntryActivityAction[] = [
  "login",
  "logout",
  "transaction_viewed",
  "transaction_cancelled",
  "category_changed",
  "account_changed",
  "auth_failure",
];

export interface QuickEntryActivityLog {
  id: string;
  action: QuickEntryActivityAction;
  detail: Record<string, unknown>;
  transactionId: string | null;
  userId: string;
  userName: string;
  branchId: string;
  timestamp?: Timestamp;
}

/** Lowercase, trim, collapse whitespace, and strip punctuation — tolerant matching for "Fayeeq MH" vs "Fayeeq.MH" vs "FAYEEQ  MH" vs "Fayeeq M H". */
export function normalizePayeeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Loose containment check used by payee rule matching: true if every "word" of the shorter normalized string appears in the longer one, in order-independent fashion. Tolerant of "Fayeeq M H" vs "Fayeeq MH" (word count differs) without being so loose it matches unrelated payees. */
export function payeeTextsLooselyMatch(a: string, b: string): boolean {
  const normA = normalizePayeeText(a);
  const normB = normalizePayeeText(b);
  if (!normA || !normB) return false;
  if (normA === normB) return true;

  const compact = (s: string) => s.replace(/\s+/g, "");
  const compactA = compact(normA);
  const compactB = compact(normB);
  if (compactA === compactB) return true;

  // Token-subset match: the rule's tokens must all appear (as substrings,
  // to tolerate "Fayeeq" vs "Fayeeq.MH" style joins) in the candidate text.
  const ruleTokens = normA.split(" ").filter(Boolean);
  const candidateCompact = compactB;
  return ruleTokens.length > 0 && ruleTokens.every((token) => candidateCompact.includes(token));
}
