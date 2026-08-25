import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where, type Firestore } from "firebase/firestore";
import { firestore as defaultFirestore } from "@/lib/firebase";
import { DEFAULT_BRANCH_ID, roundCurrency, toDateKey, toTimeKey, type FinancePaymentMethod } from "@/lib/finance";
import {
  QUICK_ENTRY_SOURCE,
  EMPTY_AI_EXTRACTION,
  type AIExtractedPayment,
  type QuickEntryActivityAction,
  type QuickEntryActivityLog,
  type QuickEntryRecord,
} from "@/lib/quickEntry";
import { analyzePaymentScreenshot, isGeminiUnavailableError } from "@/lib/geminiVision";
import { getFinanceAccounts } from "@/services/financeAccountsService";
import { getExpenseCategories } from "@/services/financeCategoriesService";
import { createFinanceTransaction, getPostedTransactionsForRange } from "@/services/financeTransactionsService";
import { matchPayeeRule, seedDefaultPayeeRules } from "@/services/quickEntryPayeeRulesService";
import type { FinanceAccount, FinanceExpenseCategory, FinanceTransaction } from "@/lib/finance";

// ─────────────────────────────────────────────────────────────────────────
// Quick Entry orchestration.
//
// This is the ONLY place that ties together: the isolated Gemini vision
// client (lib/geminiVision.ts, AI extraction ONLY — never writes anything),
// payee-rule matching, duplicate detection, and — critically — the
// EXISTING createFinanceTransaction() function
// (services/financeTransactionsService.ts) that the Transactions tab
// already uses. Nothing here re-implements balance updates, category
// rollups, or the fin_transactions schema; it only prepares inputs for
// that existing function and records Quick-Entry-specific metadata (AI
// payload, activity log) in the new, independent quick_entry_*
// collections defined in lib/quickEntry.ts.
//
// By explicit request, screenshots themselves are NOT stored anywhere —
// the image is sent to Gemini for extraction only and then discarded. If
// that changes later, re-introduce a Storage upload step here (Firebase
// Storage isn't provisioned for this project yet, so screenshot retention
// would need that set up first).
// ─────────────────────────────────────────────────────────────────────────

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB — generous for a phone screenshot, small enough to stay well under Gemini's inline-data limit.
const DUPLICATE_LOOKBACK_DAYS = 60;

function quickEntryRecordsCollection(db: Firestore) {
  return collection(db, "quick_entry_records");
}
function quickEntryActivityCollection(db: Firestore) {
  return collection(db, "quick_entry_activity_logs");
}

function base64ByteLength(base64: string): number {
  const clean = base64.replace(/=+$/, "");
  return Math.floor((clean.length * 3) / 4);
}

export interface LogQuickEntryActivityInput {
  action: QuickEntryActivityAction;
  detail?: Record<string, unknown>;
  transactionId?: string | null;
  userId: string;
  userName: string;
  branchId?: string;
}

/** Writes one Quick Entry activity log entry (spec §20). Never throws into the caller's main flow — a logging failure shouldn't block a real transaction from saving. */
export async function logQuickEntryActivity(input: LogQuickEntryActivityInput, db: Firestore = defaultFirestore): Promise<void> {
  try {
    const ref = doc(quickEntryActivityCollection(db));
    await setDoc(ref, {
      action: input.action,
      detail: input.detail ?? {},
      transactionId: input.transactionId ?? null,
      userId: input.userId,
      userName: input.userName,
      branchId: input.branchId ?? DEFAULT_BRANCH_ID,
      timestamp: serverTimestamp(),
    });
  } catch (error) {
    console.error("[quickEntryService] Failed to write activity log", error);
  }
}

export interface GetActivityOptions {
  branchId?: string;
  /** When set, only this user's own actions are returned — used for a Finance Manager's own Activity Log view. Admins pass undefined to see everything. */
  onlyUserId?: string;
  limitCount?: number;
}

export async function getQuickEntryActivity(
  options: GetActivityOptions = {},
  db: Firestore = defaultFirestore,
): Promise<QuickEntryActivityLog[]> {
  const branchId = options.branchId ?? DEFAULT_BRANCH_ID;
  // Sorted in memory, not via Firestore orderBy, so this never needs a new
  // composite index — same trade-off as getPayeeRules above and
  // listFinanceTransactions elsewhere in this app.
  const snapshot = await getDocs(query(quickEntryActivityCollection(db), where("branchId", "==", branchId)));
  let rows = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<QuickEntryActivityLog, "id">) }));
  if (options.onlyUserId) rows = rows.filter((r) => r.userId === options.onlyUserId);
  rows.sort((a, b) => {
    const aMs = a.timestamp && typeof a.timestamp === "object" && "seconds" in a.timestamp ? (a.timestamp as { seconds: number }).seconds : 0;
    const bMs = b.timestamp && typeof b.timestamp === "object" && "seconds" in b.timestamp ? (b.timestamp as { seconds: number }).seconds : 0;
    return bMs - aMs;
  });
  const limitCount = options.limitCount ?? 200;
  return rows.slice(0, limitCount);
}

function findAccountByNameContains(accounts: FinanceAccount[], needle: string): FinanceAccount | undefined {
  const lower = needle.toLowerCase();
  return accounts.find((a) => a.status === "active" && a.name.toLowerCase().includes(lower));
}

/** Spec §6: default to the existing IDBI Bank account by name, never a hardcoded id. Falls back to the first active bank/cash account, then any active account, so Quick Entry still opens (with a manual account choice) even if IDBI doesn't exist in this deployment. */
export function pickDefaultAccount(accounts: FinanceAccount[]): FinanceAccount | null {
  const idbi = findAccountByNameContains(accounts, "idbi");
  if (idbi) return idbi;
  const activeBank = accounts.find((a) => a.status === "active" && a.type === "bank");
  if (activeBank) return activeBank;
  const anyActive = accounts.find((a) => a.status === "active");
  return anyActive ?? null;
}

/** Only trusts the AI's free-text category guess if it fuzzy-matches an EXISTING category name — spec §5/§9/§10: the AI never creates or invents a category. */
export function resolveSuggestedCategory(
  categories: FinanceExpenseCategory[],
  suggestedName: string | null,
): FinanceExpenseCategory | null {
  if (!suggestedName) return null;
  const needle = suggestedName.trim().toLowerCase();
  if (!needle) return null;
  return (
    categories.find((c) => c.active && c.name.toLowerCase() === needle) ??
    categories.find((c) => c.active && (c.name.toLowerCase().includes(needle) || needle.includes(c.name.toLowerCase()))) ??
    null
  );
}

export interface DuplicateCandidate {
  transactionId: string;
  date: string;
  time: string;
  amount: number;
  description: string;
  categoryName: string | null;
  fromAccountName: string | null;
  referenceNumber: string;
}

function toDuplicateCandidate(t: FinanceTransaction): DuplicateCandidate {
  return {
    transactionId: t.id,
    date: t.date,
    time: t.time,
    amount: t.amount,
    description: t.description,
    categoryName: t.categoryName,
    fromAccountName: t.fromAccountName,
    referenceNumber: t.referenceNumber,
  };
}

/**
 * Spec §14: checks for a likely-already-recorded payment using the
 * EXISTING transaction data (no separate duplicate-tracking table). A
 * reference-number match is treated as a strong signal on its own; a bare
 * amount+date match is weaker (common for round-number expenses) so it's
 * still surfaced, but the UI should let the Finance Manager judge it.
 */
export async function findDuplicateCandidates(
  amount: number,
  date: string,
  referenceNumber: string | null,
  db: Firestore = defaultFirestore,
  branchId: string = DEFAULT_BRANCH_ID,
): Promise<DuplicateCandidate[]> {
  const to = date > toDateKey() ? date : toDateKey();
  const from = new Date(`${date}T00:00:00`);
  from.setDate(from.getDate() - DUPLICATE_LOOKBACK_DAYS);
  const dateFrom = toDateKey(from);

  const transactions = await getPostedTransactionsForRange(dateFrom, to, db, branchId);
  const normalizedRef = referenceNumber?.trim().toLowerCase();

  const matches = transactions.filter((t) => {
    if (normalizedRef && t.referenceNumber?.trim().toLowerCase() === normalizedRef) return true;
    return t.amount === roundCurrency(amount) && t.date === date;
  });

  return matches.slice(0, 5).map(toDuplicateCandidate);
}

export interface AnalyzeQuickEntryInput {
  base64Data: string;
  mimeType: string;
  userId: string;
  userName: string;
  branchId?: string;
}

export interface AnalyzeQuickEntryResult {
  extracted: AIExtractedPayment;
  aiError: string | null;
  accounts: FinanceAccount[];
  defaultAccountId: string | null;
  categories: FinanceExpenseCategory[];
  matchedCategoryId: string | null;
  matchedCategorySource: "payee_rule" | "ai_suggestion" | null;
  matchedPayeeRuleId: string | null;
  duplicates: DuplicateCandidate[];
}

/**
 * Full "upload → AI read → prepare review screen" pipeline (spec §5/§6/§7/
 * §8/§9/§14). Returns everything the review screen needs; does NOT create
 * a transaction — see saveQuickEntryTransaction for that, which only runs
 * after the Finance Manager confirms.
 */
export async function analyzeQuickEntryScreenshot(
  input: AnalyzeQuickEntryInput,
  db: Firestore = defaultFirestore,
): Promise<AnalyzeQuickEntryResult> {
  const branchId = input.branchId ?? DEFAULT_BRANCH_ID;
  const mimeType = input.mimeType?.toLowerCase();

  if (!mimeType || !ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error("Unsupported image type. Please upload a JPG, PNG, or WEBP screenshot.");
  }
  if (!input.base64Data) {
    throw new Error("No image data received.");
  }
  if (base64ByteLength(input.base64Data) > MAX_IMAGE_BYTES) {
    throw new Error("This image is too large. Please upload a screenshot under 8MB.");
  }

  // "screenshot_uploaded" here means "received for analysis", not "stored"
  // — by explicit request, the image itself is never persisted anywhere.
  await logQuickEntryActivity(
    { action: "screenshot_uploaded", userId: input.userId, userName: input.userName, branchId },
    db,
  );

  // Ensure the built-in payee rules exist (idempotent) before we try to use them below.
  await seedDefaultPayeeRules(input.userId, input.userName, db, branchId).catch((error) => {
    console.error("[quickEntryService] Failed to seed default payee rules", error);
  });

  let extracted: AIExtractedPayment = { ...EMPTY_AI_EXTRACTION };
  let aiError: string | null = null;
  try {
    extracted = await analyzePaymentScreenshot(input.base64Data, mimeType);
    await logQuickEntryActivity(
      { action: "screenshot_analyzed", userId: input.userId, userName: input.userName, branchId, detail: { confidence: extracted.confidence, readable: extracted.readable } },
      db,
    );
  } catch (error) {
    aiError = isGeminiUnavailableError(error)
      ? error.message
      : "We couldn't read this payment clearly. Please upload a clearer screenshot or enter the details manually.";
    await logQuickEntryActivity(
      { action: "ai_unavailable", userId: input.userId, userName: input.userName, branchId, detail: { message: aiError } },
      db,
    );
  }

  const [accounts, categories] = await Promise.all([
    getFinanceAccounts({}, db),
    getExpenseCategories({}, db),
  ]);

  const defaultAccount = pickDefaultAccount(accounts);

  let matchedCategoryId: string | null = null;
  let matchedCategorySource: "payee_rule" | "ai_suggestion" | null = null;
  let matchedPayeeRuleId: string | null = null;

  // Priority order (spec §9): manual selection (handled entirely on the
  // frontend, not here) → explicit business rule → AI suggestion → ask.
  if (extracted.payee) {
    const rule = await matchPayeeRule(extracted.payee, db, branchId);
    if (rule) {
      matchedCategoryId = rule.categoryId;
      matchedCategorySource = "payee_rule";
      matchedPayeeRuleId = rule.id;
    }
  }
  if (!matchedCategoryId && extracted.suggestedCategory) {
    const aiMatch = resolveSuggestedCategory(categories, extracted.suggestedCategory);
    if (aiMatch) {
      matchedCategoryId = aiMatch.id;
      matchedCategorySource = "ai_suggestion";
    }
  }

  let duplicates: DuplicateCandidate[] = [];
  if (extracted.amount) {
    duplicates = await findDuplicateCandidates(extracted.amount, extracted.date ?? toDateKey(), extracted.referenceNumber, db, branchId);
    if (duplicates.length > 0) {
      await logQuickEntryActivity(
        { action: "duplicate_warning_shown", userId: input.userId, userName: input.userName, branchId, detail: { count: duplicates.length } },
        db,
      );
    }
  }

  return {
    extracted,
    aiError,
    accounts,
    defaultAccountId: defaultAccount?.id ?? null,
    categories,
    matchedCategoryId,
    matchedCategorySource,
    matchedPayeeRuleId,
    duplicates,
  };
}

export interface SaveQuickEntryInput {
  amount: number;
  date: string;
  time: string;
  accountId: string;
  payee: string;
  categoryId: string;
  paymentMethod: FinancePaymentMethod | null;
  referenceNumber: string;
  notes: string;
  aiExtracted: AIExtractedPayment;
  matchedPayeeRuleId: string | null;
  duplicateOverridden: boolean;
  branchId?: string;
}

/**
 * Confirms and saves a Quick Entry payment (spec §11/§12/§13). Creates the
 * transaction through the EXISTING createFinanceTransaction() — same
 * function, same balance/category/audit-log side effects as any
 * Transactions-tab entry — then attaches the raw AI payload via the new
 * quick_entry_records collection, keyed by the resulting transaction id.
 * Never touches fin_transactions' shape directly. No screenshot is stored
 * anywhere, by explicit request — see the file header comment.
 */
export async function saveQuickEntryTransaction(
  input: SaveQuickEntryInput,
  userId: string,
  userName: string,
  db: Firestore = defaultFirestore,
): Promise<{ transaction: FinanceTransaction }> {
  const branchId = input.branchId ?? DEFAULT_BRANCH_ID;

  try {
    if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("Enter a valid amount.");
    if (!input.accountId) throw new Error("Select which account this was paid from.");
    if (!input.categoryId) throw new Error("Select an expense category before saving.");

    const transaction = await createFinanceTransaction(
      {
        type: "expense",
        date: input.date,
        time: input.time,
        categoryId: input.categoryId,
        description: input.payee ? `Payment to ${input.payee}` : "Quick Entry payment",
        amount: input.amount,
        fromAccountId: input.accountId,
        paymentMethod: input.paymentMethod ?? undefined,
        remarks: [input.notes, input.payee ? `Payee: ${input.payee}` : null, `Recorded via Quick Entry`].filter(Boolean).join(" · "),
        referenceNumber: input.referenceNumber,
        branchId,
      },
      userId,
      userName,
      db,
    );

    const record: Omit<QuickEntryRecord, "id"> = {
      transactionId: transaction.id,
      aiExtracted: input.aiExtracted,
      matchedPayeeRuleId: input.matchedPayeeRuleId,
      duplicateWarningShown: false,
      duplicateOverridden: input.duplicateOverridden,
      branchId,
      createdBy: userId,
      createdByName: userName,
      createdAt: serverTimestamp() as never,
    };
    await setDoc(doc(quickEntryRecordsCollection(db), transaction.id), record);

    if (input.duplicateOverridden) {
      await logQuickEntryActivity(
        { action: "duplicate_confirmed", userId, userName, branchId, transactionId: transaction.id },
        db,
      );
    }
    await logQuickEntryActivity(
      {
        action: "transaction_created",
        userId,
        userName,
        branchId,
        transactionId: transaction.id,
        detail: { amount: transaction.amount, payee: input.payee, categoryName: transaction.categoryName, source: QUICK_ENTRY_SOURCE },
      },
      db,
    );

    return { transaction };
  } catch (error) {
    await logQuickEntryActivity(
      {
        action: "transaction_creation_failed",
        userId,
        userName,
        branchId,
        detail: { message: error instanceof Error ? error.message : "Unknown error" },
      },
      db,
    );
    throw error;
  }
}

export async function getQuickEntryRecord(transactionId: string, db: Firestore = defaultFirestore): Promise<QuickEntryRecord | null> {
  const snap = await getDoc(doc(quickEntryRecordsCollection(db), transactionId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<QuickEntryRecord, "id">) };
}
