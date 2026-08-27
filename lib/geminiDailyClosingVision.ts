import { EMPTY_DAILY_CLOSING_IMAGE_EXTRACTION, type DailyClosingImageExtraction, type DailyClosingImageItem } from "@/lib/dailyClosingImage";

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
const REQUEST_TIMEOUT_MS = 25_000;

export class GeminiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiUnavailableError";
  }
}

export function isGeminiUnavailableError(error: unknown): error is GeminiUnavailableError {
  return error instanceof GeminiUnavailableError;
}

function buildPrompt(existingCategoryNames: string[]): string {
  const categoryList = existingCategoryNames.length > 0 ? existingCategoryNames.join(", ") : "(no categories configured yet)";

  return `You are reading a photo of a handwritten restaurant Daily Closing sheet. It lists expense line items and amounts, and usually ends with a "Closing" or "Outstanding" total line.

Existing Dajaj expense categories (choose ONLY from this exact list, or return null — never invent a category):
${categoryList}

Rules:
- Extract every visible line item as a separate entry in "items", EXCEPT the final "Closing"/"Outstanding" summary line — that one goes in the separate "closingLine" field instead, never in "items".
- "rawLabel" is the handwritten item name as best you can read it (e.g. "Veg", "Gas", "Petrol").
- "amount" is the plain number for that line, with no currency symbols/commas. If the amount is blank, illegible, or missing, return null — never invent a number.
- "category" must be one of the exact category names listed above (case-sensitive match to that list), chosen by matching the item's MEANING against them — not just spelling. Use everyday commonsense reasoning about what the item actually is:
  - Spelling/abbreviation matches: "Veg"/"Veggies"/"VEG" all mean "Vegetables" if that's in the list.
  - Semantic matches (no shared letters needed): a branded snack item like "Lays" (a chips brand) is a food/grocery purchase — match it to whichever category represents food ingredients/groceries (e.g. "Ingredients", "Grocery", "Food") if one exists in the list. A word like "Parcel" (a delivery/packing charge) is a small miscellaneous cost — match it to whichever category represents general/miscellaneous expenses (e.g. "Misc", "Miscellaneous") if one exists in the list.
  - If you can reason out what kind of expense an item is (food/ingredient, utility, packaging, staff, etc.) and a category in the list represents that concept, pick it even if the words don't overlap textually.
  - If truly nothing in the list fits the item's meaning at all, but a category resembling "Misc"/"Miscellaneous" exists in the list, use that rather than returning null.
  - Only return null if you are not confident of the item's meaning, or no category above and no "Misc"-style category exists — never invent a new category name.
- "categoryConfidence" and "amountConfidence" are your own 0 to 1 estimates for that line.
- "crossedOut" is true if the line is visibly struck through / crossed out on the sheet.
- CRITICAL — hyphens are separators, not minus signs: a line written like "Veg - 240 -" means amount = 240 (positive), not -240. Do not treat a dash next to a number as a negative sign.
- CRITICAL — the "Closing"/"Outstanding" line: put it in "closingLine", not "items". "amount" is always a positive number. "sign" is 1 if the line says "Closing" (a positive balance) and -1 if it says "Outstanding" (a negative balance) — the word's meaning decides the sign, regardless of any dash next to the number. For example "Closing - 1890" → amount 1890, sign 1. "Outstanding - 500" → amount 500, sign -1. If there is no such summary line visible, return closingLine as null.
- "date": YYYY-MM-DD if a date is clearly written on the sheet, else null — never guess a date.
- "readable" is false if the image is too blurry/dark/cut off to make out the sheet at all, or it isn't a Daily Closing sheet — true otherwise.
- Handle poor lighting, shadows, blur, perspective distortion, creased paper, underlines, different handwriting styles, minor spelling mistakes, and abbreviations — do your best, but never fabricate a value you can't actually make out.`;
}

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    date: { type: "STRING", nullable: true },
    readable: { type: "BOOLEAN" },
    items: {
      type: "ARRAY",
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
  // Trust the label's own meaning over a possibly-inconsistent numeric sign
  // from the model — "Outstanding" is always negative, "Closing" is always
  // positive, per spec §12, regardless of what "sign" the model returned.
  const sign: 1 | -1 = label?.toLowerCase().includes("outstanding")
    ? -1
    : label?.toLowerCase().includes("closing")
    ? 1
    : rawSign === -1
    ? -1
    : 1;

  return { label, amount, sign };
}

function coerceExtraction(raw: unknown): DailyClosingImageExtraction {
  if (typeof raw !== "object" || raw === null) return { ...EMPTY_DAILY_CLOSING_IMAGE_EXTRACTION };
  const r = raw as Record<string, unknown>;

  const date = typeof r.date === "string" && DATE_RE.test(r.date) ? r.date : null;
  const readable = typeof r.readable === "boolean" ? r.readable : false;
  const items = Array.isArray(r.items) ? r.items.map(coerceItem).filter((item): item is DailyClosingImageItem => item !== null) : [];
  const closingLine = coerceClosingLine(r.closingLine);

  return { date, readable, items, closingLine };
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

/**
 * Sends one Daily Closing sheet photo to Gemini and returns a validated
 * DailyClosingImageExtraction. `existingCategoryNames` MUST be the
 * caller's current active expense category names (see
 * services/dailyClosingImageService.ts) — the AI is instructed to choose
 * only from that list or return null, never invent a category.
 *
 * Throws GeminiUnavailableError (never a raw fetch/parse error) on any
 * failure — callers should fall back to manual entry rather than surface
 * a stack trace.
 */
export async function analyzeDailyClosingSheet(
  base64Data: string,
  mimeType: string,
  existingCategoryNames: string[],
): Promise<DailyClosingImageExtraction> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new GeminiUnavailableError("The AI sheet reader isn't configured yet (missing GEMINI_API_KEY).");
  }
  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: buildPrompt(existingCategoryNames) }, { inlineData: { mimeType, data: base64Data } }],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0,
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new GeminiUnavailableError(`The AI sheet reader is temporarily unavailable (HTTP ${response.status}). ${errorBody.slice(0, 200)}`);
    }

    const payload = (await response.json()) as GeminiGenerateContentResponse;
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new GeminiUnavailableError("The AI sheet reader returned an empty response.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new GeminiUnavailableError("The AI sheet reader returned an unreadable response.");
    }

    return coerceExtraction(parsed);
  } catch (error) {
    if (isGeminiUnavailableError(error)) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new GeminiUnavailableError("The AI sheet reader took too long to respond.");
    }
    throw new GeminiUnavailableError(error instanceof Error ? error.message : "The AI sheet reader is unavailable.");
  } finally {
    clearTimeout(timeout);
  }
}
