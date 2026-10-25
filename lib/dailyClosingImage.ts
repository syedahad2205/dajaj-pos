// ─────────────────────────────────────────────────────────────────────────
// "Read from Image" — Daily Closing shared types.
//
// This feature is an ADDITIONAL way to populate the EXISTING Daily Closing
// form (services/financeClosingService.ts, app/admin/finance/closing/
// page.tsx) — it introduces no new Firestore collection, no new save path,
// and no new validation rules. The AI only ever produces a structured
// reading of the uploaded sheet; everything here is untrusted input until
// the Finance Manager reviews it and it flows through the EXISTING
// addDailyClosingExpenses()/closeDailyClosing() functions.
// ─────────────────────────────────────────────────────────────────────────

/** One handwritten line item, before any category resolution. Raw AI output — untrusted. */
export interface DailyClosingImageItem {
  rawLabel: string;
  /** null if the amount was blank/unclear on the sheet — never invented. */
  amount: number | null;
  /** The AI's own free-text category guess. Only ever trusted by the backend if it exactly matches (case-insensitively) one of the category names it was given — see services/dailyClosingImageService.ts. */
  aiCategory: string | null;
  categoryConfidence: number;
  amountConfidence: number;
  crossedOut: boolean;
  /** "staff_salary": a ticked salary row whose amount came from the staff's daily salary setting, not the sheet. */
  amountSource?: "sheet" | "staff_salary";
}

/** The special "Closing"/"Outstanding" summary line, extracted separately from the item list per spec §12 — "Closing" is always a positive balance, "Outstanding" is always negative, regardless of the separator dash. */
export interface DailyClosingImageClosingLine {
  /** The word actually written ("Closing", "Outstanding", or whatever variant) — kept for display, not re-parsed. */
  label: string | null;
  amount: number;
  sign: 1 | -1;
}

/** The sheet's "Juice Lab" row (Revenue / Collected / Pending). Each value is null when blank on the sheet — never invented. */
export interface DailyClosingImageJuiceLab {
  revenue: number | null;
  collected: number | null;
  pending: number | null;
}

/** One row of the sheet's "Daily Stock" table, as written. Values null when blank / dash — never invented. */
export interface DailyClosingImageStockRow {
  label: string;
  opening: number | null;
  closing: number | null;
  order: number | null;
}

/** The sheet's "Total Shawarmas Sold" grid. null = blank cell. */
export interface DailyClosingImageShawarma {
  khubbusRoll: number | null;
  khubbusPlate: number | null;
  rumaliRoll: number | null;
  rumaliPlate: number | null;
}

/** One printed row of the sheet's "A. FIXED EXPENSES (Salary)" table (staff salaries + PIGMI). */
export interface DailyClosingImageFixedExpense {
  /** Printed row name, e.g. "Sahil – Salary", "PIGMI". */
  label: string;
  /** PAID box ticked. A ticked salary with no amount means "paid at the usual daily salary". */
  paid: boolean;
  /** Handwritten amount, or null when blank — never invented. */
  amount: number | null;
}

/** Raw, validated (but not yet category-resolved) AI extraction. */
export interface DailyClosingImageExtraction {
  /** YYYY-MM-DD if a date was clearly visible on the sheet — never guessed. */
  date: string | null;
  /** false if the image was unreadable / not a Daily Closing sheet at all. */
  readable: boolean;
  items: DailyClosingImageItem[];
  closingLine: DailyClosingImageClosingLine | null;
  /** null when the sheet has no Juice Lab row or all three cells are blank. */
  juiceLab: DailyClosingImageJuiceLab | null;
  stock: DailyClosingImageStockRow[];
  shawarma: DailyClosingImageShawarma | null;
  /** Handwritten OPENING BALANCE — a cross-check against the app's Opening Cash only, never saved. */
  openingBalance: number | null;
  /** Printed fixed-expense rows; empty for free-form (non-printed) sheets. */
  fixedExpenses: DailyClosingImageFixedExpense[];
  /** Set when one of the two AI requests failed but the other succeeded — shown as a warning. */
  partialError?: string;
}

export const EMPTY_DAILY_CLOSING_IMAGE_EXTRACTION: DailyClosingImageExtraction = {
  date: null,
  readable: false,
  items: [],
  closingLine: null,
  juiceLab: null,
  stock: [],
  shawarma: null,
  openingBalance: null,
  fixedExpenses: [],
};

/** A stock row matched to a configured stock item (itemId null = no match — shown, but not applied). */
export interface ResolvedDailyClosingImageStockRow extends DailyClosingImageStockRow {
  itemId: string | null;
  itemName: string | null;
}

/** How an item's category ended up resolved (or not) — surfaced to the UI so an AI-guessed match can be shown differently from a deterministic one, per spec §6's priority ladder. "misc_fallback" means neither a deterministic nor a validated AI match was found, so it was defaulted to the existing "Misc"-style category rather than left blank — still fully editable by the Finance Manager. */
export type DailyClosingCategoryMatchSource = "deterministic" | "ai" | "misc_fallback" | null;

/** DailyClosingImageItem plus the resolved existing-category fields the review UI actually needs. Category resolution NEVER invents a category — categoryId is null whenever neither the deterministic matcher nor the AI's own (list-validated) guess found one, and the Finance Manager must pick one before that row can be applied. */
export interface ResolvedDailyClosingImageItem extends DailyClosingImageItem {
  categoryId: string | null;
  categoryName: string | null;
  categorySource: DailyClosingCategoryMatchSource;
  /** True only for a synthetic row injected by a business default (e.g. "Salary" — see services/dailyClosingImageService.ts) rather than something actually read off the sheet. Never set on AI-extracted rows. */
  isDefault?: boolean;
}

/** A sheet line that matched an existing Cash Deposit type by name (e.g. "Pigmi") — pulled OUT of `items` since a deposit isn't a business expense (spec: deposits use the Daily Closing form's separate Cash Deposits section, not an expense category). `amount` is null if the sheet left it blank — never invented. */
export interface DailyClosingImageDepositCandidate {
  /** A CashDepositType value from lib/finance.ts (only "pigmi" is enabled today, but this stays generic as more types are added there). */
  type: string;
  typeLabel: string;
  amount: number | null;
  remarks: string;
}

export interface ResolvedDailyClosingImageExtraction {
  date: string | null;
  readable: boolean;
  items: ResolvedDailyClosingImageItem[];
  closingLine: DailyClosingImageClosingLine | null;
  deposits: DailyClosingImageDepositCandidate[];
  juiceLab: DailyClosingImageJuiceLab | null;
  stock: ResolvedDailyClosingImageStockRow[];
  shawarma: DailyClosingImageShawarma | null;
  openingBalance: number | null;
}
