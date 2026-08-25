import { EMPTY_AI_EXTRACTION, type AIExtractedPayment } from "@/lib/quickEntry";

// ─────────────────────────────────────────────────────────────────────────
// Isolated Gemini vision client for Quick Entry.
//
// This is the ONLY file that knows which AI provider/model Quick Entry
// uses. services/quickEntryService.ts calls analyzePaymentScreenshot()
// and only ever sees an AIExtractedPayment back — swapping providers later
// (or adding a fallback provider) means editing this file alone, per the
// explicit requirement that the AI integration stay isolated behind a
// backend service.
//
// Model: Gemini 3.1 Flash-Lite (gemini-3.1-flash-lite), per user direction.
// Uses the Gemini API's plain REST endpoint (no SDK dependency added) so
// there's nothing new to install — just a server-only GEMINI_API_KEY.
// The free tier (Google AI Studio) works against this same endpoint/model,
// no special code path needed for it.
//
// Gemini is used for extraction ONLY. It never creates, updates, or
// deletes a transaction — see services/quickEntryService.ts, which treats
// everything returned here as untrusted input to be validated and shown
// to the Finance Manager for review before anything is saved.
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

const EXTRACTION_PROMPT = `You are looking at a screenshot of a single payment (a UPI app, bank app, or payment confirmation screen). Extract ONLY what is visibly present in the image into the given JSON schema.

Rules:
- Never guess or invent a value. If a field isn't clearly visible, use null (or false/"unknown" per its type).
- "amount" is the payment amount as a plain number (no currency symbols, no commas).
- "date" must be YYYY-MM-DD if a date is visible, else null.
- "time" must be HH:mm (24-hour) if a time is visible, else null.
- "status": "success" if the screenshot clearly shows a completed/successful payment, "failed" if declined/failed, "pending" if pending/processing, otherwise "unknown".
- "paymentMethod": one of "upi", "card", "bank_transfer", "cash", "cheque", "other", or null if unclear.
- "payee" is the name of who was PAID (the beneficiary/merchant/recipient), not the payer.
- "referenceNumber" is the UTR / transaction ID / reference number, if visible.
- "suggestedCategory" is your best plain-English guess at an expense category name for this payment (e.g. "Chicken", "Vegetables", "Fuel", "Rent") based on the payee/context — a short guess, not a certainty. Null if you have no reasonable guess.
- "readable" is false if the image is blurry, cut off, not a payment screenshot at all, or otherwise unusable — true otherwise.
- "confidence" is your own 0 to 1 estimate of how confident you are in this extraction overall.
- "notes" can hold any other useful detail you noticed that doesn't fit another field (max ~200 characters).`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    amount: { type: "NUMBER", nullable: true },
    currency: { type: "STRING", nullable: true },
    date: { type: "STRING", nullable: true },
    time: { type: "STRING", nullable: true },
    status: { type: "STRING", enum: ["success", "failed", "pending", "unknown"] },
    paymentMethod: { type: "STRING", nullable: true, enum: ["upi", "card", "bank_transfer", "cash", "cheque", "other"] },
    bankName: { type: "STRING", nullable: true },
    accountIdentifier: { type: "STRING", nullable: true },
    payee: { type: "STRING", nullable: true },
    referenceNumber: { type: "STRING", nullable: true },
    notes: { type: "STRING", nullable: true },
    suggestedCategory: { type: "STRING", nullable: true },
    confidence: { type: "NUMBER" },
    readable: { type: "BOOLEAN" },
  },
  required: ["status", "confidence", "readable"],
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const PAYMENT_METHODS = new Set(["upi", "card", "bank_transfer", "cash", "cheque", "other"]);
const STATUSES = new Set(["success", "failed", "pending", "unknown"]);

function cleanString(value: unknown, maxLength = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

/** Re-types and bounds-checks the AI's raw JSON before it's trusted anywhere else in the app. Never throws — anything unusable just becomes null/"unknown". */
function coerceExtraction(raw: unknown): AIExtractedPayment {
  if (typeof raw !== "object" || raw === null) return { ...EMPTY_AI_EXTRACTION };
  const r = raw as Record<string, unknown>;

  const amount = typeof r.amount === "number" && Number.isFinite(r.amount) && r.amount > 0 ? r.amount : null;
  const date = typeof r.date === "string" && DATE_RE.test(r.date) ? r.date : null;
  const time = typeof r.time === "string" && TIME_RE.test(r.time) ? r.time : null;
  const status = typeof r.status === "string" && STATUSES.has(r.status) ? (r.status as AIExtractedPayment["status"]) : "unknown";
  const paymentMethod =
    typeof r.paymentMethod === "string" && PAYMENT_METHODS.has(r.paymentMethod) ? (r.paymentMethod as AIExtractedPayment["paymentMethod"]) : null;
  const confidence = typeof r.confidence === "number" && Number.isFinite(r.confidence) ? Math.min(1, Math.max(0, r.confidence)) : 0;
  const readable = typeof r.readable === "boolean" ? r.readable : false;

  return {
    amount,
    currency: cleanString(r.currency, 10),
    date,
    time,
    status,
    paymentMethod,
    bankName: cleanString(r.bankName, 100),
    accountIdentifier: cleanString(r.accountIdentifier, 40),
    payee: cleanString(r.payee, 100),
    referenceNumber: cleanString(r.referenceNumber, 100),
    notes: cleanString(r.notes, 200),
    suggestedCategory: cleanString(r.suggestedCategory, 60),
    confidence,
    readable,
  };
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

/**
 * Sends one payment screenshot to Gemini 3.1 Flash-Lite and returns a
 * validated AIExtractedPayment. Throws GeminiUnavailableError (never a raw
 * fetch/parse error) if the API key is missing, the request fails, or the
 * response can't be parsed — callers should catch this specifically and
 * fall back to manual entry rather than surface a raw stack trace.
 */
export async function analyzePaymentScreenshot(base64Data: string, mimeType: string): Promise<AIExtractedPayment> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new GeminiUnavailableError("Quick Entry's AI screenshot reader isn't configured yet (missing GEMINI_API_KEY).");
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
            parts: [{ text: EXTRACTION_PROMPT }, { inlineData: { mimeType, data: base64Data } }],
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
      throw new GeminiUnavailableError(`AI screenshot reader is temporarily unavailable (HTTP ${response.status}). ${errorBody.slice(0, 200)}`);
    }

    const payload = (await response.json()) as GeminiGenerateContentResponse;
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new GeminiUnavailableError("The AI screenshot reader returned an empty response.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new GeminiUnavailableError("The AI screenshot reader returned an unreadable response.");
    }

    return coerceExtraction(parsed);
  } catch (error) {
    if (isGeminiUnavailableError(error)) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new GeminiUnavailableError("The AI screenshot reader took too long to respond.");
    }
    throw new GeminiUnavailableError(error instanceof Error ? error.message : "The AI screenshot reader is unavailable.");
  } finally {
    clearTimeout(timeout);
  }
}
