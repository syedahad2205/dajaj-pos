import type { Firestore } from "firebase/firestore";
import { firestore as defaultFirestore } from "@/lib/firebase";
import { CASH_DEPOSIT_TYPE_LABELS, DEFAULT_BRANCH_ID, SUPPORTED_CASH_DEPOSIT_TYPES, type FinanceExpenseCategory } from "@/lib/finance";
import {
  EMPTY_DAILY_CLOSING_IMAGE_EXTRACTION,
  type DailyClosingImageDepositCandidate,
  type DailyClosingImageItem,
  type ResolvedDailyClosingImageExtraction,
  type ResolvedDailyClosingImageItem,
} from "@/lib/dailyClosingImage";
import { payeeTextsLooselyMatch } from "@/lib/quickEntry";
import { analyzeDailyClosingSheet, isGeminiUnavailableError } from "@/lib/geminiDailyClosingVision";
import { getExpenseCategories } from "@/services/financeCategoriesService";

// ─────────────────────────────────────────────────────────────────────────
// "Read from Image" analysis for Daily Closing.
//
// Purely read + transform — this file NEVER writes to Firestore. It fetches
// the existing active expense categories, sends the image + that category
// list to the isolated Gemini client (lib/geminiDailyClosingVision.ts), and
// resolves each item's category against the REAL existing categories only
// (spec §6/§7/§8 — never invents one). The caller (the API route, then the
// review UI) is responsible for actually saving anything, and only ever
// does so through the EXISTING addDailyClosingExpenses()/closeDailyClosing()
// functions in services/financeClosingService.ts.
// ─────────────────────────────────────────────────────────────────────────

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function base64ByteLength(base64: string): number {
  const clean = base64.replace(/=+$/, "");
  return Math.floor((clean.length * 3) / 4);
}

/**
 * Deterministic fuzzy match (spec §6 steps 1-4: exact / case-insensitive /
 * minor spelling variation / abbreviation) between a handwritten label and
 * an existing category name. Reuses the same loose text matcher Quick
 * Entry's payee rules already use (lib/quickEntry.ts) — it's generic text
 * normalization, not payee-specific, so sharing it here doesn't couple the
 * two features. Checked in both directions since either the label ("Veg")
 * or the category ("Petrol") can be the shorter/abbreviated side.
 */
function findDeterministicCategoryMatch(categories: FinanceExpenseCategory[], rawLabel: string): FinanceExpenseCategory | null {
  return (
    categories.find((c) => payeeTextsLooselyMatch(rawLabel, c.name) || payeeTextsLooselyMatch(c.name, rawLabel)) ?? null
  );
}

/** Spec §6 step 5 fallback: trust the AI's own category guess ONLY if it exactly (case-insensitively) matches one of the real categories it was given — never a fuzzy/invented match at this stage, since the AI was already told the exact list to pick from. */
function findValidatedAiCategoryMatch(categories: FinanceExpenseCategory[], aiCategory: string | null): FinanceExpenseCategory | null {
  if (!aiCategory) return null;
  const needle = aiCategory.trim().toLowerCase();
  if (!needle) return null;
  return categories.find((c) => c.name.toLowerCase() === needle) ?? null;
}

/**
 * Last-resort fallback (business rule, applied after both real matches
 * fail): if the restaurant already has a category whose name is some
 * variant of "Misc"/"Miscellaneous", default unresolved lines to it
 * instead of leaving them blank. This is still never inventing a
 * category — it only fires when such a category already exists in the
 * real list — and the row stays fully editable so the Finance Manager
 * can pick something else during review.
 */
function findMiscFallbackCategory(categories: FinanceExpenseCategory[]): FinanceExpenseCategory | null {
  return categories.find((c) => /\bmisc(ellaneous)?\b/i.test(c.name)) ?? null;
}

function resolveItem(categories: FinanceExpenseCategory[], item: DailyClosingImageItem): ResolvedDailyClosingImageItem {
  const deterministic = findDeterministicCategoryMatch(categories, item.rawLabel);
  if (deterministic) {
    return { ...item, categoryId: deterministic.id, categoryName: deterministic.name, categorySource: "deterministic" };
  }
  const aiMatch = findValidatedAiCategoryMatch(categories, item.aiCategory);
  if (aiMatch) {
    return { ...item, categoryId: aiMatch.id, categoryName: aiMatch.name, categorySource: "ai" };
  }
  const miscFallback = findMiscFallbackCategory(categories);
  if (miscFallback) {
    return { ...item, categoryId: miscFallback.id, categoryName: miscFallback.name, categorySource: "misc_fallback" };
  }
  // Spec §8/§10: amount is preserved regardless — only the category is
  // left unresolved for the Finance Manager to pick manually (no
  // Misc-style category exists to fall back to).
  return { ...item, categoryId: null, categoryName: null, categorySource: null };
}

/**
 * Business rule: any sheet line whose label matches an existing Cash
 * Deposit type's name (today, only "Pigmi" — SUPPORTED_CASH_DEPOSIT_TYPES
 * in lib/finance.ts) is pulled OUT of the expense items and returned as a
 * deposit candidate instead. A deposit isn't a business expense — it has
 * no category, and the existing Daily Closing form has a dedicated Cash
 * Deposits section for exactly this. Extensible automatically: adding a
 * new type to SUPPORTED_CASH_DEPOSIT_TYPES makes it recognized here too,
 * no code change needed.
 */
function splitOutDepositCandidates(
  items: ResolvedDailyClosingImageItem[],
): { items: ResolvedDailyClosingImageItem[]; deposits: DailyClosingImageDepositCandidate[] } {
  const remainingItems: ResolvedDailyClosingImageItem[] = [];
  const deposits: DailyClosingImageDepositCandidate[] = [];

  for (const item of items) {
    const depositType = SUPPORTED_CASH_DEPOSIT_TYPES.find(
      (type) => payeeTextsLooselyMatch(item.rawLabel, CASH_DEPOSIT_TYPE_LABELS[type]) || payeeTextsLooselyMatch(CASH_DEPOSIT_TYPE_LABELS[type], item.rawLabel),
    );
    if (depositType) {
      deposits.push({ type: depositType, typeLabel: CASH_DEPOSIT_TYPE_LABELS[depositType], amount: item.amount, remarks: item.rawLabel });
    } else {
      remainingItems.push(item);
    }
  }

  return { items: remainingItems, deposits };
}

const SALARY_DEFAULT_AMOUNT = 2500;
const SALARY_LABEL = "Salary";

/**
 * Business rule: if this sheet doesn't mention Salary at all, add a
 * default ₹2,500 Salary expense so it's never silently skipped just
 * because it wasn't written down that day. Checked against THIS sheet's
 * own extraction only (not the day's already-saved expenses) — matched by
 * loose text against both the raw label and any already-resolved category
 * name, same tolerant matching used everywhere else in this file. Clearly
 * flagged `isDefault: true` so the review UI can label it distinctly from
 * anything actually read off the sheet, and it stays fully editable/
 * removable like any other row.
 */
function ensureSalaryDefault(items: ResolvedDailyClosingImageItem[], categories: FinanceExpenseCategory[]): ResolvedDailyClosingImageItem[] {
  const alreadyMentioned = items.some(
    (item) =>
      payeeTextsLooselyMatch(item.rawLabel, SALARY_LABEL) ||
      payeeTextsLooselyMatch(SALARY_LABEL, item.rawLabel) ||
      (item.categoryName && (payeeTextsLooselyMatch(item.categoryName, SALARY_LABEL) || payeeTextsLooselyMatch(SALARY_LABEL, item.categoryName))),
  );
  if (alreadyMentioned) return items;

  const salaryCategory = categories.find((c) => c.name.toLowerCase() === SALARY_LABEL.toLowerCase()) ?? null;
  const defaultItem: ResolvedDailyClosingImageItem = {
    rawLabel: "Salary (default — not on sheet)",
    amount: SALARY_DEFAULT_AMOUNT,
    aiCategory: null,
    categoryConfidence: 1,
    amountConfidence: 1,
    crossedOut: false,
    isDefault: true,
    categoryId: salaryCategory?.id ?? null,
    categoryName: salaryCategory?.name ?? null,
    categorySource: salaryCategory ? "deterministic" : null,
  };
  return [...items, defaultItem];
}

export interface AnalyzeDailyClosingImageInput {
  base64Data: string;
  mimeType: string;
  branchId?: string;
}

export interface AnalyzeDailyClosingImageResult {
  extraction: ResolvedDailyClosingImageExtraction;
  categories: FinanceExpenseCategory[];
  aiError: string | null;
}

export async function analyzeDailyClosingImage(
  input: AnalyzeDailyClosingImageInput,
  db: Firestore = defaultFirestore,
): Promise<AnalyzeDailyClosingImageResult> {
  const branchId = input.branchId ?? DEFAULT_BRANCH_ID;
  const mimeType = input.mimeType?.toLowerCase();

  if (!mimeType || !ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error("Unsupported image type. Please upload a JPG, PNG, or WEBP photo.");
  }
  if (!input.base64Data) {
    throw new Error("No image data received.");
  }
  if (base64ByteLength(input.base64Data) > MAX_IMAGE_BYTES) {
    throw new Error("This image is too large. Please upload a photo under 8MB.");
  }

  const categories = await getExpenseCategories({ branchId }, db); // active only

  let aiError: string | null = null;
  let rawExtraction = EMPTY_DAILY_CLOSING_IMAGE_EXTRACTION;
  try {
    rawExtraction = await analyzeDailyClosingSheet(input.base64Data, mimeType, categories.map((c) => c.name));
  } catch (error) {
    aiError = isGeminiUnavailableError(error)
      ? error.message
      : "Unable to read the image clearly. Please upload a clearer photo or enter the values manually.";
  }

  if (!aiError && !rawExtraction.readable) {
    aiError = "Unable to read the image clearly. Please upload a clearer photo or enter the values manually.";
  }

  const resolvedItems = rawExtraction.items.map((item) => resolveItem(categories, item));
  const { items: itemsWithoutDeposits, deposits } = splitOutDepositCandidates(resolvedItems);
  const finalItems = ensureSalaryDefault(itemsWithoutDeposits, categories);

  return {
    extraction: {
      date: rawExtraction.date,
      readable: rawExtraction.readable,
      items: finalItems,
      closingLine: rawExtraction.closingLine,
      deposits,
    },
    categories,
    aiError,
  };
}
