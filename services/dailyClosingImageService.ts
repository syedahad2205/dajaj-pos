import { getStockPricingConfig } from "@/services/financeClosingService";
import type { StaffSalaryConfig, StockItemConfig } from "@/lib/finance";
import type { DailyClosingImageFixedExpense, DailyClosingImageStockRow, ResolvedDailyClosingImageStockRow } from "@/lib/dailyClosingImage";
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

/** Printed rows of the sheet's "B. EXPENSES" table — a blank one simply wasn't used that day. */
const PRINTED_EXPENSE_ROWS = new Set(["vegetables", "parcel charges", "food"]);

const SALARY_DEFAULT_AMOUNT = 1800;
const SALARY_LABEL = "Salary";

/**
 * Business rule: if this sheet doesn't mention Salary at all, add a
 * default ₹1,800 Salary expense so it's never silently skipped just
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

  const [categories, stockConfig] = await Promise.all([
    getExpenseCategories({ branchId }, db), // active only
    getStockPricingConfig(db),
  ]);

  let aiError: string | null = null;
  let rawExtraction = EMPTY_DAILY_CLOSING_IMAGE_EXTRACTION;
  try {
    rawExtraction = await analyzeDailyClosingSheet(
      input.base64Data,
      mimeType,
      categories.map((c) => c.name),
      stockConfig.items.filter((i) => i.active).map((i) => ({ id: i.id, name: i.name })),
    );
  } catch (error) {
    aiError = isGeminiUnavailableError(error)
      ? error.message
      : "Unable to read the image clearly. Please upload a clearer photo or enter the values manually.";
  }

  if (!aiError && rawExtraction.partialError) {
    aiError = rawExtraction.partialError;
  }
  if (!aiError && !rawExtraction.readable) {
    aiError = "Unable to read the image clearly. Please upload a clearer photo or enter the values manually.";
  }

  const fixedItems = fixedExpensesToItems(rawExtraction.fixedExpenses ?? [], stockConfig.staff);
  // The AI lists every expense row (so amounts can't slide between rows);
  // rows with no amount are dropped here unless they look handwritten-but-unreadable.
  const sheetItems = rawExtraction.items.filter((item) => item.amount !== null || !PRINTED_EXPENSE_ROWS.has(item.rawLabel.trim().toLowerCase()));
  const resolvedItems = [...fixedItems, ...sheetItems].map((item) => resolveItem(categories, item));
  const { items: itemsWithoutDeposits, deposits } = splitOutDepositCandidates(resolvedItems);
  // Printed sheets list every salary row explicitly (ticked or not), so the
  // "no salary written → add the default" rule only applies to free-form sheets.
  const finalItems =
    (rawExtraction.fixedExpenses ?? []).length > 0 ? itemsWithoutDeposits : ensureSalaryDefault(itemsWithoutDeposits, categories);

  return {
    extraction: {
      date: rawExtraction.date,
      readable: rawExtraction.readable,
      items: finalItems,
      closingLine: rawExtraction.closingLine,
      deposits,
      juiceLab: rawExtraction.juiceLab ?? null,
      stock: resolveStockRows(rawExtraction.stock ?? [], stockConfig.items),
      shawarma: rawExtraction.shawarma ?? null,
      openingBalance: rawExtraction.openingBalance ?? null,
    },
    categories,
    aiError,
  };
}

/** Loose key for matching handwritten/printed stock labels to configured items ("Tandoori Kabab" ≈ "Tandoori Kebab"). */
function stockKey(text: string): string {
  return text.toLowerCase().replace(/kabab|kabob/g, "kebab").replace(/[^a-z]/g, "");
}

/** Matches each sheet stock row to a configured stock item (exact key first, then contains). Never invents an item. */
function resolveStockRows(rows: DailyClosingImageStockRow[], items: StockItemConfig[]): ResolvedDailyClosingImageStockRow[] {
  const used = new Set<string>();
  return rows.map((row) => {
    const key = stockKey(row.label);
    const match =
      items.find((i) => !used.has(i.id) && stockKey(i.name) === key) ??
      items.find((i) => !used.has(i.id) && key.length >= 4 && (stockKey(i.name).includes(key) || key.includes(stockKey(i.name))));
    if (match) used.add(match.id);
    return { ...row, itemId: match?.id ?? null, itemName: match?.name ?? null };
  });
}

/**
 * Printed "A. FIXED EXPENSES (Salary)" rows → expense lines for review:
 *   - a staff salary row that is ticked PAID or has an amount becomes a line;
 *     a written amount wins, otherwise that person's daily salary from
 *     Settings (amountSource "staff_salary"); if neither is known the amount
 *     is left blank for the manager to type in;
 *   - the PIGMI row (ticked or with an amount) becomes a "Pigmi" line, which
 *     splitOutDepositCandidates then turns into a Cash Deposit;
 *   - unticked rows with no amount are skipped.
 */
function fixedExpensesToItems(rows: DailyClosingImageFixedExpense[], staff: StaffSalaryConfig[]): DailyClosingImageItem[] {
  const items: DailyClosingImageItem[] = [];
  for (const row of rows) {
    if (!row.paid && row.amount === null) continue;
    const label = row.label.toLowerCase();
    const base = { aiCategory: null, categoryConfidence: 1, amountConfidence: row.amount === null ? 0.5 : 1, crossedOut: false };
    if (/pigmi/.test(label)) {
      items.push({ ...base, rawLabel: "Pigmi", amount: row.amount });
      continue;
    }
    const person = staff.find((p) => p.active && label.includes(p.name.trim().toLowerCase()));
    const fromSettings = row.amount === null && person?.dailySalary != null;
    items.push({
      ...base,
      rawLabel: person ? `${person.name} – Salary` : row.label,
      aiCategory: "Salary",
      amount: row.amount ?? person?.dailySalary ?? null,
      amountSource: fromSettings ? "staff_salary" : "sheet",
    });
  }
  return items;
}
