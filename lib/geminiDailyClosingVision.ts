import {
  EMPTY_DAILY_CLOSING_IMAGE_EXTRACTION,
  type DailyClosingImageExtraction,
  type DailyClosingImageItem,
  type DailyClosingImageFixedExpense,
  type DailyClosingImageJuiceLab,
  type DailyClosingImageShawarma,
  type DailyClosingImageStockRow,
} from "@/lib/dailyClosingImage";

// ─────────────────────────────────────────────────────────────────────────
// Isolated Gemini vision client for Daily Closing's "Read from Image".
//
// Deliberately self-contained (does not share code with
// lib/geminiVision.ts, the Quick Entry AI client) — each feature's AI
// integration stays independently swappable, per the explicit requirement
// that "the AI integration must be isolated behind a backend service so
// the model can be changed later without affecting the rest of the
// application." services/dailyClosingImageService.ts is the only caller
// and only ever sees a validated DailyClosingImageExtraction back.
//
// Model: Gemini 3.1 Flash-Lite (gemini-3.1-flash-lite), same provider/key
// as Quick Entry (GEMINI_API_KEY / GEMINI_MODEL — nothing new to
// configure). Plain REST call, no SDK dependency.
//
// The AI is used for extraction ONLY. It never creates, updates, or
// deletes a Daily Closing record — services/dailyClosingImageService.ts
// and app/admin/finance/closing/page.tsx treat every field here as
// untrusted input to be reviewed/edited before anything is saved through
// the EXISTING addDailyClosingExpenses()/closeDailyClosing() functions.
// ─────────────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = "gemini-3.1-flash-lite";
// The sheet reading returns a lot (expenses, closing line, Juice Lab, stock
// table, shawarmas), so it needs more time than the single-field readers.
// Must stay below the read-image route's maxDuration (60 s).
const REQUEST_TIMEOUT_MS = 55_000;
/** Each half of the sheet is well under 2k tokens; this only stops runaway (looping) answers. */
const MAX_OUTPUT_TOKENS = 4096;

export class GeminiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiUnavailableError";
  }
}

export function isGeminiUnavailableError(error: unknown): error is GeminiUnavailableError {
  return error instanceof GeminiUnavailableError;
}

// The sheet is read with TWO requests in parallel — section 1 (expenses,
// salaries, totals) in one; Juice Lab / Daily Stock / Shawarmas in the other.
// One combined request had to write a very long answer and ran past the time
// limit; two half-size answers come back faster, and one failing doesn't
// lose the other.
//
// Both prompts describe DAJAJ's printed "DAILY CLOSING & STOCK" form: printed
// labels, boxes and tick boxes, filled in by hand. Keep them in step with the
// printed sheet if the form ever changes.

const SHEET_INTRO = `You are reading a photo of DAJAJ restaurant's printed "DAILY CLOSING & STOCK" sheet. It is a PRINTED FORM (printed headings, labels, tables and tick boxes) filled in BY HAND with numbers, ticks and a few extra item names. Printed text is only labels — the values are the handwriting.

The photo is often taken sideways or upside down: first find the title "DAILY CLOSING & STOCK" and read everything in the sheet's own orientation.

Layout of the form:
- Top: title, "DATE: ____".
- Left half, "1. DAILY CLOSING": "OPENING BALANCE ₹", table "A. FIXED EXPENSES (Salary)" (printed rows such as "Sahil – Salary", "Anees – Salary", "Shaban – Salary", "PIGMI"; columns PAID ✓ tick box and AMOUNT ₹), table "B. EXPENSES (Regular & Optional)" (printed rows "Vegetables", "Parcel Charges", "Food", then blank rows for handwritten items; column AMOUNT ₹), then "OUTSTANDING / CLOSING ₹", the "JUICE LAB" row (REVENUE ₹ | COLLECTED ₹ | PENDING ₹) and "FINAL OUTSTANDING / CLOSING ₹".
- Right half: "2. DAILY STOCK" (ITEM | OPENING | CLOSING | ORDER) and "3. TOTAL SHAWARMAS SOLD" (ITEM | ROLL | PLATE, rows Khubbus and Rumali).

Reading numbers:
- Indian rupee notation: "550/-", "330/-", "80-", "150 -" mean 550, 330, 80, 150. A "/-" or a dash after a number is NOT a minus sign.
- A cell that is blank, or holds only a dash "-" / "—" / "~", has no value: return null. A written "0" is 0.
- Read each value on the SAME line as its printed label: follow the table row across. Never move a number up or down to a neighbouring row, and never take a number from a different section.
- Handle glare, shadows, blur, curled paper and messy handwriting — do your best, but never invent a value you cannot actually see.`;

function buildExpensesPrompt(existingCategoryNames: string[]): string {
  const categoryList = existingCategoryNames.length > 0 ? existingCategoryNames.join(", ") : "(no categories configured yet)";

  return `${SHEET_INTRO}

In THIS request read ONLY the date and section "1. DAILY CLOSING" (except the JUICE LAB row). Ignore "2. DAILY STOCK", "3. TOTAL SHAWARMAS SOLD" and the JUICE LAB row — they are read separately.

Return:
- "date": the handwritten DATE as YYYY-MM-DD. Dates are written day/month/year (Indian format); a 2-digit year means 20YY — "21/10/26" is 2026-10-21. null if not clearly written.
- "readable": false if the photo is too blurry/dark/cut off to read, or it is not this sheet; true otherwise.
- "openingBalance": the handwritten number after "OPENING BALANCE ₹", or null.
- "fixedExpenses": one entry per printed row of table "A. FIXED EXPENSES (Salary)", in order. "label" = the printed row name exactly (e.g. "Sahil – Salary", "PIGMI"). "paid" = true if the PAID box has a tick / check / cross mark in it, false if the box is empty. "amount" = the handwritten AMOUNT, or null if blank. A ticked box with no amount is normal (paid at the usual daily rate) — return paid true, amount null; never fill in a salary yourself.
- "items": EVERY row of table "B. EXPENSES (Regular & Optional)", top to bottom, in order — the printed rows (Vegetables, Parcel Charges, Food) AND each handwritten row (e.g. Curd, Milk, Freshener) — including rows whose AMOUNT is blank (then amount null). Listing every row keeps each amount on its own row: an amount belongs to the label on the SAME line; if a printed row has no amount, the next amount down belongs to the NEXT row, never to it. Stop at the last row that has writing. Never put salaries, PIGMI, the opening balance, totals or Juice Lab in "items".
  - "rawLabel": the printed or handwritten item name as written (fix obvious spelling, e.g. "FRESHNER" → "Freshener").
  - "amount": the handwritten number (rupee notation as above).
  - "category": one of these existing DAJAJ expense categories, written exactly as listed, or null:
${categoryList}
    Match by MEANING, not just spelling: "Veg" → Vegetables; dairy (curd, milk), groceries and branded snacks → a food/ingredients/grocery category if one exists; packing/parcel charges or small odd costs → a Misc-style category if one exists. If nothing fits but a "Misc"/"Miscellaneous" category exists, use it. Never invent a category name.
  - "categoryConfidence", "amountConfidence": your own 0–1 confidence for that row.
  - "crossedOut": true if the row is struck through.
- "closingLine": the cash total. If "FINAL OUTSTANDING / CLOSING ₹" has a handwritten number, use it (label "FINAL OUTSTANDING / CLOSING"); otherwise use "OUTSTANDING / CLOSING ₹" (label "OUTSTANDING / CLOSING"). "amount" is the plain positive number. The printed label contains BOTH words, so it does not tell you the sign: "sign" = 1 normally (cash in hand); "sign" = -1 ONLY if the handwritten value itself is marked negative — a minus sign BEFORE the number, the number in brackets, or "OS" / "Outstanding" / "Short" handwritten or circled next to it. "330/-" is positive. null if both are blank.`;
}

/** A stock item the reader should look for — from Settings (finance_stock_config). */
export interface SheetStockItem {
  id: string;
  name: string;
}

function buildCountsPrompt(stockItems: SheetStockItem[]): string {
  return `${SHEET_INTRO}

In THIS request read ONLY three things: the JUICE LAB row, "2. DAILY STOCK" and "3. TOTAL SHAWARMAS SOLD". Ignore all expenses, salaries, the opening balance and the closing totals.

Return:
- "juiceLab": the JUICE LAB row (between "OUTSTANDING / CLOSING" and "FINAL OUTSTANDING / CLOSING"). Juice Lab is a separate juice counter that sells through DAJAJ's till and UPI: REVENUE = Juice Lab's sales for the day, COLLECTED = cash Juice Lab took from the drawer, PENDING = what is still owed to Juice Lab (paid later from UPI). Normally REVENUE = COLLECTED + PENDING, so use that to double-check your reading. Return "revenue", "collected", "pending" — each the handwritten number, or null if blank or a dash (a dash in PENDING means nothing is pending). Return juiceLab null if the whole row is blank.
- "stock": the "2. DAILY STOCK" table. It has exactly one slot per item row — fill each slot from that item's row: ${stockItems.map((i) => `"${i.id}" = ${i.name}`).join(", ")}. For each: "opening", "closing", "order" = the handwritten number in that column of that row, or null. Read along each row; keep each number in its own column. Use null for the whole slot if the row isn't on the sheet. Quantities can be fractions — read them carefully, a small fraction next to a digit is easy to miss: "8½" or "8 1/2" = 8.5, "1½" = 1.5, "2¼" or "2 1/4" = 2.25, "2¾" or "2 3/4" = 2.75, "½" = 0.5, "¼" = 0.25.
- "shawarma": "3. TOTAL SHAWARMAS SOLD" → "khubbusRoll", "khubbusPlate", "rumaliRoll", "rumaliPlate", each the handwritten number or null. A trailing dot or dash ("100.", "100-") is not part of the number. null if the whole grid is blank.`;
}

const EXPENSES_SCHEMA = {
  type: "OBJECT",
  properties: {
    date: { type: "STRING", nullable: true },
    readable: { type: "BOOLEAN" },
    openingBalance: { type: "NUMBER", nullable: true },
    fixedExpenses: {
      type: "ARRAY",
      maxItems: 10,
      items: {
        type: "OBJECT",
        properties: {
          label: { type: "STRING" },
          paid: { type: "BOOLEAN" },
          amount: { type: "NUMBER", nullable: true },
        },
        required: ["label", "paid"],
      },
    },
    items: {
      type: "ARRAY",
      maxItems: 25,
      items: {
        type: "OBJECT",
        properties: {
          rawLabel: { type: "STRING" },
          amount: { type: "NUMBER", nullable: true },
          category: { type: "STRING", nullable: true },
          categoryConfidence: { type: "NUMBER" },
          amountConfidence: { type: "NUMBER" },
          crossedOut: { type: "BOOLEAN" },
        },
        required: ["rawLabel", "categoryConfidence", "amountConfidence", "crossedOut"],
      },
    },
    closingLine: {
      type: "OBJECT",
      nullable: true,
      properties: {
        label: { type: "STRING", nullable: true },
        amount: { type: "NUMBER" },
        sign: { type: "NUMBER" },
      },
      required: ["amount", "sign"],
    },
  },
  required: ["readable", "items"],
};

const COUNTS_SCHEMA_BASE = {
  type: "OBJECT",
  properties: {
    juiceLab: {
      type: "OBJECT",
      nullable: true,
      properties: {
        revenue: { type: "NUMBER", nullable: true },
        collected: { type: "NUMBER", nullable: true },
        pending: { type: "NUMBER", nullable: true },
      },
    },
    // stock: one fixed slot per configured item (built in countsSchema) — an
    // open-ended array let the model loop, repeating rows until it hit the
    // output limit.
    shawarma: {
      type: "OBJECT",
      nullable: true,
      properties: {
        khubbusRoll: { type: "NUMBER", nullable: true },
        khubbusPlate: { type: "NUMBER", nullable: true },
        rumaliRoll: { type: "NUMBER", nullable: true },
        rumaliPlate: { type: "NUMBER", nullable: true },
      },
    },
  },
};

function countsSchema(stockItems: SheetStockItem[]) {
  const slot = {
    type: "OBJECT",
    nullable: true,
    properties: {
      opening: { type: "NUMBER", nullable: true },
      closing: { type: "NUMBER", nullable: true },
      order: { type: "NUMBER", nullable: true },
    },
  };
  return {
    ...COUNTS_SCHEMA_BASE,
    properties: {
      ...COUNTS_SCHEMA_BASE.properties,
      stock: { type: "OBJECT", nullable: true, properties: Object.fromEntries(stockItems.map((i) => [i.id, slot])) },
    },
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cleanString(value: unknown, maxLength = 120): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function coerceItem(raw: unknown): DailyClosingImageItem | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const rawLabel = cleanString(r.rawLabel, 100);
  if (!rawLabel) return null; // an item with no readable label at all isn't usable — drop it rather than show a blank row

  const amount = typeof r.amount === "number" && Number.isFinite(r.amount) && r.amount > 0 ? r.amount : null;
  const categoryConfidence = typeof r.categoryConfidence === "number" && Number.isFinite(r.categoryConfidence) ? Math.min(1, Math.max(0, r.categoryConfidence)) : 0;
  const amountConfidence = typeof r.amountConfidence === "number" && Number.isFinite(r.amountConfidence) ? Math.min(1, Math.max(0, r.amountConfidence)) : 0;
  const crossedOut = r.crossedOut === true;

  return {
    rawLabel,
    amount,
    aiCategory: cleanString(r.category, 80),
    categoryConfidence,
    amountConfidence,
    crossedOut,
  };
}

function coerceClosingLine(raw: unknown): DailyClosingImageExtraction["closingLine"] {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const amount = typeof r.amount === "number" && Number.isFinite(r.amount) ? Math.abs(r.amount) : null;
  if (amount === null || amount === 0) return null;

  const label = cleanString(r.label, 40);
  const rawSign = typeof r.sign === "number" ? r.sign : null;
  const lower = label?.toLowerCase() ?? "";
  // The printed form labels the box "OUTSTANDING / CLOSING" — both words — so
  // the label can't decide the sign there; trust the model's sign, which
  // the prompt bases on the handwriting itself. Only a free-form label with
  // just one of the words decides the sign by its meaning.
  const both = lower.includes("outstanding") && lower.includes("closing");
  const sign: 1 | -1 = both
    ? rawSign === -1
      ? -1
      : 1
    : lower.includes("outstanding")
    ? -1
    : lower.includes("closing")
    ? 1
    : rawSign === -1
    ? -1
    : 1;

  return { label, amount, sign };
}

function coerceJuiceLab(raw: unknown): DailyClosingImageJuiceLab | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  const juiceLab = { revenue: num(r.revenue), collected: num(r.collected), pending: num(r.pending) };
  return juiceLab.revenue === null && juiceLab.collected === null && juiceLab.pending === null ? null : juiceLab;
}

const nonNegative = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/** Stock comes back as { [itemId]: { opening, closing, order } } — one fixed slot per configured item. */
function coerceStock(raw: unknown, stockItems: SheetStockItem[]): DailyClosingImageStockRow[] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return [];
  const slots = raw as Record<string, unknown>;
  const rows: DailyClosingImageStockRow[] = [];
  for (const item of stockItems) {
    const o = slots[item.id];
    if (typeof o !== "object" || o === null) continue;
    const r = o as Record<string, unknown>;
    const row = { label: item.name, opening: nonNegative(r.opening), closing: nonNegative(r.closing), order: nonNegative(r.order) };
    if (row.opening !== null || row.closing !== null || row.order !== null) rows.push(row);
  }
  return rows;
}

function coerceShawarma(raw: unknown): DailyClosingImageShawarma | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const s = { khubbusRoll: nonNegative(o.khubbusRoll), khubbusPlate: nonNegative(o.khubbusPlate), rumaliRoll: nonNegative(o.rumaliRoll), rumaliPlate: nonNegative(o.rumaliPlate) };
  return Object.values(s).every((v) => v === null) ? null : s;
}

function coerceExtraction(raw: unknown, stockItems: SheetStockItem[]): DailyClosingImageExtraction {
  if (typeof raw !== "object" || raw === null) return { ...EMPTY_DAILY_CLOSING_IMAGE_EXTRACTION };
  const r = raw as Record<string, unknown>;

  const date = typeof r.date === "string" && DATE_RE.test(r.date) ? r.date : null;
  const readable = typeof r.readable === "boolean" ? r.readable : false;
  const items = Array.isArray(r.items) ? r.items.map(coerceItem).filter((item): item is DailyClosingImageItem => item !== null) : [];
  const closingLine = coerceClosingLine(r.closingLine);
  const juiceLab = coerceJuiceLab(r.juiceLab);
  const stock = coerceStock(r.stock, stockItems);
  const shawarma = coerceShawarma(r.shawarma);
  const openingBalance = typeof r.openingBalance === "number" && Number.isFinite(r.openingBalance) ? r.openingBalance : null;
  const fixedExpenses = Array.isArray(r.fixedExpenses)
    ? r.fixedExpenses
        .map((f) => {
          if (typeof f !== "object" || f === null) return null;
          const o = f as Record<string, unknown>;
          const label = cleanString(o.label, 60);
          return label ? { label, paid: o.paid === true, amount: typeof o.amount === "number" && Number.isFinite(o.amount) && o.amount > 0 ? o.amount : null } : null;
        })
        .filter((f): f is DailyClosingImageFixedExpense => f !== null)
    : [];

  return { date, readable, items, closingLine, juiceLab, stock, shawarma, openingBalance, fixedExpenses };
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
  usageMetadata?: { candidatesTokenCount?: number; thoughtsTokenCount?: number };
}

/**
 * One structured Gemini call. Asks for the minimal thinking level (some
 * Gemini models reason at length before answering unless told not to); if
 * the model rejects that setting it retries once without it, so a model
 * change can never make every read fail.
 */
async function callGemini(prompt: string, schema: unknown, base64Data: string, mimeType: string, signal: AbortSignal, label: string): Promise<unknown> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new GeminiUnavailableError("The AI sheet reader isn't configured yet (missing GEMINI_API_KEY).");
  }
  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const send = (withThinking: boolean) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType, data: base64Data } }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: schema,
          temperature: 0,
          // A sheet answer is a few KB; cap it so a model stuck repeating rows
          // stops in seconds instead of running until the timeout.
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          ...(withThinking ? { thinkingConfig: { thinkingLevel: "minimal" } } : {}),
        },
      }),
    });

  const started = Date.now();
  let usedThinking = true;
  let response = await send(true);
  if (response.status === 400) {
    const body = await response.text().catch(() => "");
    if (/thinking/i.test(body)) {
      usedThinking = false;
      response = await send(false);
    } else {
      throw new GeminiUnavailableError(`The AI sheet reader is temporarily unavailable (HTTP 400). ${body.slice(0, 200)}`);
    }
  }
  if (!response.ok) {
    console.log(`[geminiDailyClosingVision] ${label}: HTTP ${response.status} in ${Date.now() - started} ms (model ${model})`);
    const errorBody = await response.text().catch(() => "");
    throw new GeminiUnavailableError(`The AI sheet reader is temporarily unavailable (HTTP ${response.status}). ${errorBody.slice(0, 200)}`);
  }

  const payload = (await response.json()) as GeminiGenerateContentResponse;
  const finishReason = payload.candidates?.[0]?.finishReason ?? "?";
  console.log(
    `[geminiDailyClosingVision] ${label}: ${Date.now() - started} ms, finish ${finishReason}, output ${payload.usageMetadata?.candidatesTokenCount ?? "?"} tokens, thinking ${payload.usageMetadata?.thoughtsTokenCount ?? 0} (model ${model}, thinkingLevel ${usedThinking ? "minimal" : "default"})`,
  );
  if (finishReason === "MAX_TOKENS") {
    throw new GeminiUnavailableError("The AI got stuck repeating itself on this photo. Try again, or retake the photo flat and well lit.");
  }
  const text = payload.candidates?.[0]?.content?.parts?.find((part) => !part.thought && part.text)?.text;
  if (!text) {
    throw new GeminiUnavailableError("The AI sheet reader returned an empty response.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new GeminiUnavailableError("The AI sheet reader returned an unreadable response.");
  }
}

function toUnavailable(error: unknown): GeminiUnavailableError {
  if (isGeminiUnavailableError(error)) return error;
  if (error instanceof Error && error.name === "AbortError") return new GeminiUnavailableError("The AI sheet reader took too long to respond.");
  return new GeminiUnavailableError(error instanceof Error ? error.message : "The AI sheet reader is unavailable.");
}

/**
 * Sends one Daily Closing sheet photo to Gemini — as two parallel requests
 * (see the note above buildExpensesPrompt) — and returns a validated
 * DailyClosingImageExtraction. `existingCategoryNames` MUST be the caller's
 * current active expense category names (see
 * services/dailyClosingImageService.ts) — the AI is instructed to choose
 * only from that list or return null, never invent a category.
 *
 * If only one half fails, the other half is still returned with
 * `partialError` set. Throws GeminiUnavailableError (never a raw
 * fetch/parse error) only when both fail — callers should fall back to
 * manual entry rather than surface a stack trace.
 */
export async function analyzeDailyClosingSheet(
  base64Data: string,
  mimeType: string,
  existingCategoryNames: string[],
  stockItems: SheetStockItem[],
): Promise<DailyClosingImageExtraction> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const [expenses, counts] = await Promise.allSettled([
      callGemini(buildExpensesPrompt(existingCategoryNames), EXPENSES_SCHEMA, base64Data, mimeType, controller.signal, "expenses"),
      callGemini(buildCountsPrompt(stockItems), countsSchema(stockItems), base64Data, mimeType, controller.signal, "stock/juice/shawarma"),
    ]);

    if (expenses.status === "rejected" && counts.status === "rejected") throw toUnavailable(expenses.reason);

    const expensesRaw = expenses.status === "fulfilled" && typeof expenses.value === "object" && expenses.value !== null ? expenses.value : {};
    const countsRaw = counts.status === "fulfilled" && typeof counts.value === "object" && counts.value !== null ? counts.value : {};
    const extraction = coerceExtraction({ ...countsRaw, ...expensesRaw }, stockItems);

    if (expenses.status === "rejected") {
      // The counts half worked, so the photo itself was readable.
      return { ...extraction, readable: true, partialError: `Expenses couldn't be read (${toUnavailable(expenses.reason).message}) — enter them manually.` };
    }
    if (counts.status === "rejected") {
      return { ...extraction, partialError: `Stock, Juice Lab and shawarmas couldn't be read (${toUnavailable(counts.reason).message}) — enter them manually.` };
    }
    return extraction;
  } catch (error) {
    throw toUnavailable(error);
  } finally {
    clearTimeout(timeout);
  }
}

export type SheetTitleEdge = "top" | "right" | "bottom" | "left";

const ORIENTATION_TIMEOUT_MS = 15_000;

/**
 * Which edge of the photo the sheet's title faces. Reading a sideways photo
 * makes the model slide values between rows (tested on a real sheet: every
 * expense amount shifted one row, stock rows mixed up; upright it read every
 * value correctly), so the browser asks this first on a small thumbnail and
 * rotates the photo upright before the real read. "Which edge" proved far
 * more reliable than asking for degrees (8/8 on all four rotations).
 * Returns null when unsure — the caller then sends the photo as it is.
 */
export async function detectSheetTitleEdge(base64Data: string, mimeType: string): Promise<SheetTitleEdge | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ORIENTATION_TIMEOUT_MS);
  try {
    const raw = await callGemini(
      `This photo shows a printed form whose title is "DAILY CLOSING & STOCK" (large bold text at the top of the form). The photo may be rotated. Which edge of the PHOTO is the title nearest to, and which way does the title text run? Answer "titleEdge": "top", "right", "bottom" or "left" — the edge of the photo that the top of the form faces.`,
      { type: "OBJECT", properties: { titleEdge: { type: "STRING", enum: ["top", "right", "bottom", "left"] } }, required: ["titleEdge"] },
      base64Data,
      mimeType,
      controller.signal,
      "orientation",
    );
    const edge = (raw as { titleEdge?: unknown })?.titleEdge;
    return edge === "top" || edge === "right" || edge === "bottom" || edge === "left" ? edge : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
