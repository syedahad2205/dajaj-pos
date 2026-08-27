// ─────────────────────────────────────────────────────────────────────────
// Isolated Gemini client for the Finance AI Assistant chat.
//
// Deliberately self-contained, same pattern as lib/geminiVision.ts (Quick
// Entry) and lib/geminiDailyClosingVision.ts (Daily Closing "Read from
// Image") — each AI feature's provider/model integration stays
// independently swappable. services/financeAiChatService.ts is the only
// caller and only ever sees validated FinanceAiRawAction[] back.
//
// Model: Gemini 3.1 Flash-Lite (gemini-3.1-flash-lite), same provider/key
// as every other Finance AI feature (GEMINI_API_KEY / GEMINI_MODEL —
// nothing new to configure). Plain REST call, no SDK dependency, multiple
// images sent as separate inlineData parts in one request (Gemini
// natively supports several images per call).
//
// The AI is used for extraction/classification ONLY. It never creates,
// updates, or deletes anything — services/financeAiChatService.ts treats
// every field here as untrusted input to be re-validated and resolved
// against the REAL existing categories/accounts/deposit types before an
// admin ever sees it, and nothing is written to fin_daily_closing/
// fin_transactions until that admin explicitly approves one action at a
// time.
// ─────────────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = "gemini-3.1-flash-lite";
const REQUEST_TIMEOUT_MS = 40_000; // multiple images in one call — more generous than the single-image clients

export class GeminiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiUnavailableError";
  }
}

export function isGeminiUnavailableError(error: unknown): error is GeminiUnavailableError {
  return error instanceof GeminiUnavailableError;
}

/** Raw, untrusted shape of one action as the AI returns it — free-text category/account/deposit-type names, not yet resolved against anything real. */
export interface FinanceAiRawAction {
  sourceImageIndex: number | null;
  kind: "daily_closing_field" | "transaction" | null;
  reasoning: string;
  confidence: number;
  // daily_closing_field
  date: string | null;
  field: "closingCash" | "upiSales" | "zomatoSales" | "swiggySales" | "otherIncome" | "expense" | "deposit" | null;
  value: number | null;
  expenseCategoryName: string | null;
  expenseAmount: number | null;
  expenseRemarks: string | null;
  depositType: string | null;
  depositAmount: number | null;
  depositRemarks: string | null;
  // transaction
  transactionType: "income" | "expense" | "transfer" | null;
  amount: number | null;
  time: string | null;
  categoryName: string | null;
  fromAccountName: string | null;
  toAccountName: string | null;
  remarks: string | null;
  referenceNumber: string | null;
}

export interface FinanceAiChatAnalysis {
  /** Natural-language reply shown as the assistant's chat bubble — e.g. "I found 3 things in what you sent: ...". Never empty. */
  assistantSummary: string;
  actions: FinanceAiRawAction[];
}

export const EMPTY_FINANCE_AI_CHAT_ANALYSIS: FinanceAiChatAnalysis = {
  assistantSummary: "I couldn't process that — please try again or enter it manually.",
  actions: [],
};

export interface FinanceAiChatContext {
  todayDate: string; // YYYY-MM-DD
  expenseCategoryNames: string[];
  incomeCategoryNames: string[];
  accountNames: string[];
  depositTypeLabels: string[];
}

function buildPrompt(text: string, imageCount: number, context: FinanceAiChatContext): string {
  const expenseList = context.expenseCategoryNames.length > 0 ? context.expenseCategoryNames.join(", ") : "(none configured)";
  const incomeList = context.incomeCategoryNames.length > 0 ? context.incomeCategoryNames.join(", ") : "(none configured)";
  const accountList = context.accountNames.length > 0 ? context.accountNames.join(", ") : "(none configured)";
  const depositList = context.depositTypeLabels.length > 0 ? context.depositTypeLabels.join(", ") : "(none configured)";

  return `You are DAJAJ's Finance AI Assistant, a chat bot for a restaurant's owner/admin. You are given the admin's typed message and ${imageCount} image(s) attached to it (referenced below as Image 1, Image 2, ... in the order given). Your job is to figure out what financial record(s) this represents and propose one structured "action" per record. NOTHING you propose is ever saved automatically — every action is only a suggestion an admin will review and approve or discard by hand, so it is fine (expected, even) to propose something with lower confidence rather than silently ignoring it, as long as you explain your reasoning.

Today's real-world date is ${context.todayDate}. Use this to resolve relative dates ("today", "yesterday") and as your fallback when a screenshot has no visible date at all.

The admin's typed message for this turn: "${text || "(no text, images only)"}"

Existing Dajaj expense categories (choose ONLY from this exact list for an expense, or return null): ${expenseList}
Existing Dajaj income categories (choose ONLY from this exact list for income, or return null): ${incomeList}
Existing Dajaj finance accounts (choose ONLY from this exact list when a payment/transfer clearly involves one of them, or return null): ${accountList}
Existing Cash Deposit types (choose ONLY from this exact list, or return null): ${depositList}

Two kinds of action you can propose, one object per record found:

1. "daily_closing_field" — a scalar figure or line item that belongs on one specific day's Daily Closing register. Use this for:
   - A handwritten/typed Daily Closing summary sheet listing expense line items and a final "Closing"/"Outstanding" total: emit one action per expense line item (field="expense", with expenseCategoryName/expenseAmount/expenseRemarks) using the SAME semantic-matching rules as below, one action per Cash Deposit-type line (field="deposit", with depositType/depositAmount/depositRemarks — e.g. a "Pigmi" line is a deposit, never an expense), and if a "Closing"/"Outstanding" total line is visible, one action with field="closingCash" and value = that amount (if the line says "Outstanding", the value should be negative). Never invent a line that isn't visibly on the sheet.
   - A UPI settlement screenshot: field="upiSales", value = the settled amount. **CRITICAL settlement-date rule**: UPI settlements complete the NEXT calendar day, in the early morning — so the sales this money represents are from the PREVIOUS day, not the day the settlement screenshot itself shows. Read whatever settlement date/time IS visible in the screenshot and set "date" to one day BEFORE it (e.g. a screenshot showing "Settled 27 Aug 2026, 5:30 AM" → date = "2026-08-26"). If no settlement date/time is visible at all, assume the screenshot was just received this morning and set date to one day before today's real date (${context.todayDate}). Explain this exact reasoning in your "reasoning" field every time.
   - A Zomato or Swiggy revenue/payout screenshot: field="zomatoSales" or field="swiggySales" respectively, value = the revenue figure shown. Use whatever date the screenshot itself indicates for that revenue; only apply the same next-day settlement shift as UPI if the screenshot itself clearly indicates it's a payout/settlement received the morning after, otherwise use the date shown (or today if genuinely no date is visible).
   - Any other clearly-dated daily sales figure the admin describes in text (e.g. "other income of 500 today"): field="otherIncome".
   "value" is used for closingCash/upiSales/zomatoSales/swiggySales/otherIncome only — leave it null for field="expense"/"deposit" (use expenseAmount/depositAmount instead).

2. "transaction" — a single one-off payment, receipt, or transfer that should be recorded as its own ledger entry (this is separate from the Daily Closing register). Use this for a bank transfer confirmation, a UPI payment made for a business expense, a cheque/cash receipt, money received into an account, etc. transactionType is "expense" (money paid out — needs categoryName + fromAccountName), "income" (money received — needs categoryName from the income list + toAccountName), or "transfer" (money moved between two of the admin's own accounts — needs both fromAccountName and toAccountName, which must be different). amount is the plain transaction amount. Only set fromAccountName/toAccountName if the account is clearly identifiable (by name, logo, or the admin's own text) as one of the accounts listed above — otherwise leave null rather than guessing.

Category matching rules (apply to expenseCategoryName/categoryName): match by MEANING, not just spelling — "Veg"/"Veggies" means "Vegetables" if that's in the list; a branded snack like "Lays" is a food/grocery purchase (match "Ingredients"/"Grocery"/"Food" if present); a delivery/packing charge like "Parcel" is miscellaneous (match "Misc"/"Miscellaneous" if present). If you can reason out the expense's real nature and a listed category represents that concept, pick it even without shared words. Only return null if truly nothing fits, or if a "Misc"-style category exists, prefer it over null. NEVER invent a category name not in the given list.

General rules:
- Never invent an amount, date, or name you can't actually see or that the admin didn't say — if genuinely unclear, omit that field (or skip the whole action) rather than guessing, and mention what you couldn't read in "assistantSummary".
- If an image is blurry, unreadable, or not a financial document at all, propose no action for it and say so plainly in "assistantSummary".
- "reasoning" is one or two sentences, written for the admin to read before approving — plain language, not code.
- "confidence" is your own 0 to 1 estimate for that specific action.
- "assistantSummary" is a short, friendly 1-3 sentence reply summarizing what you found overall (e.g. "I found 3 things: a ₹850 Chicken expense, a ₹4,320 UPI settlement for yesterday, and a ₹500 Pigmi deposit. Review and approve below."). If you found nothing usable, say so and suggest what would help (a clearer photo, more detail in the text, etc.).`;
}

const ACTION_ITEM_SCHEMA = {
  type: "OBJECT",
  properties: {
    sourceImageIndex: { type: "NUMBER", nullable: true },
    kind: { type: "STRING", nullable: true, enum: ["daily_closing_field", "transaction"] },
    reasoning: { type: "STRING" },
    confidence: { type: "NUMBER" },
    date: { type: "STRING", nullable: true },
    field: { type: "STRING", nullable: true, enum: ["closingCash", "upiSales", "zomatoSales", "swiggySales", "otherIncome", "expense", "deposit"] },
    value: { type: "NUMBER", nullable: true },
    expenseCategoryName: { type: "STRING", nullable: true },
    expenseAmount: { type: "NUMBER", nullable: true },
    expenseRemarks: { type: "STRING", nullable: true },
    depositType: { type: "STRING", nullable: true },
    depositAmount: { type: "NUMBER", nullable: true },
    depositRemarks: { type: "STRING", nullable: true },
    transactionType: { type: "STRING", nullable: true, enum: ["income", "expense", "transfer"] },
    amount: { type: "NUMBER", nullable: true },
    time: { type: "STRING", nullable: true },
    categoryName: { type: "STRING", nullable: true },
    fromAccountName: { type: "STRING", nullable: true },
    toAccountName: { type: "STRING", nullable: true },
    remarks: { type: "STRING", nullable: true },
    referenceNumber: { type: "STRING", nullable: true },
  },
  required: ["reasoning", "confidence"],
};

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    assistantSummary: { type: "STRING" },
    actions: { type: "ARRAY", items: ACTION_ITEM_SCHEMA },
  },
  required: ["assistantSummary", "actions"],
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function cleanString(value: unknown, maxLength = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function cleanAmount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function coerceAction(raw: unknown): FinanceAiRawAction | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const reasoning = cleanString(r.reasoning, 400) ?? "";
  const kind = r.kind === "daily_closing_field" || r.kind === "transaction" ? r.kind : null;
  if (!kind) return null; // an action we can't even classify isn't actionable — drop it rather than show a blank card

  const sourceImageIndex = typeof r.sourceImageIndex === "number" && Number.isInteger(r.sourceImageIndex) && r.sourceImageIndex >= 0 ? r.sourceImageIndex : null;
  const confidence = typeof r.confidence === "number" && Number.isFinite(r.confidence) ? Math.min(1, Math.max(0, r.confidence)) : 0;
  const date = typeof r.date === "string" && DATE_RE.test(r.date) ? r.date : null;
  const field =
    typeof r.field === "string" && ["closingCash", "upiSales", "zomatoSales", "swiggySales", "otherIncome", "expense", "deposit"].includes(r.field)
      ? (r.field as FinanceAiRawAction["field"])
      : null;
  const transactionType = r.transactionType === "income" || r.transactionType === "expense" || r.transactionType === "transfer" ? r.transactionType : null;
  const time = typeof r.time === "string" && TIME_RE.test(r.time) ? r.time : null;

  return {
    sourceImageIndex,
    kind,
    reasoning,
    confidence,
    date,
    field,
    value: typeof r.value === "number" && Number.isFinite(r.value) ? r.value : null,
    expenseCategoryName: cleanString(r.expenseCategoryName, 80),
    expenseAmount: cleanAmount(r.expenseAmount),
    expenseRemarks: cleanString(r.expenseRemarks, 200),
    depositType: cleanString(r.depositType, 60),
    depositAmount: cleanAmount(r.depositAmount),
    depositRemarks: cleanString(r.depositRemarks, 200),
    transactionType,
    amount: cleanAmount(r.amount),
    time,
    categoryName: cleanString(r.categoryName, 80),
    fromAccountName: cleanString(r.fromAccountName, 100),
    toAccountName: cleanString(r.toAccountName, 100),
    remarks: cleanString(r.remarks, 200),
    referenceNumber: cleanString(r.referenceNumber, 100),
  };
}

function coerceAnalysis(raw: unknown): FinanceAiChatAnalysis {
  if (typeof raw !== "object" || raw === null) return { ...EMPTY_FINANCE_AI_CHAT_ANALYSIS };
  const r = raw as Record<string, unknown>;
  const assistantSummary = cleanString(r.assistantSummary, 600) ?? EMPTY_FINANCE_AI_CHAT_ANALYSIS.assistantSummary;
  const actions = Array.isArray(r.actions) ? r.actions.map(coerceAction).filter((a): a is FinanceAiRawAction => a !== null) : [];
  return { assistantSummary, actions };
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

/**
 * Sends one chat turn (text + 0..N images) to Gemini and returns a
 * validated FinanceAiChatAnalysis. Throws GeminiUnavailableError (never a
 * raw fetch/parse error) on any failure — the caller should fall back to
 * showing "I couldn't process that" rather than a stack trace.
 */
export async function analyzeFinanceAiChatTurn(
  text: string,
  images: { base64Data: string; mimeType: string }[],
  context: FinanceAiChatContext,
): Promise<FinanceAiChatAnalysis> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new GeminiUnavailableError("The AI Assistant isn't configured yet (missing GEMINI_API_KEY).");
  }
  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      { text: buildPrompt(text, images.length, context) },
    ];
    images.forEach((img) => parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64Data } }));

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0,
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new GeminiUnavailableError(`The AI Assistant is temporarily unavailable (HTTP ${response.status}). ${errorBody.slice(0, 200)}`);
    }

    const payload = (await response.json()) as GeminiGenerateContentResponse;
    const responseText = payload.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!responseText) {
      throw new GeminiUnavailableError("The AI Assistant returned an empty response.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      throw new GeminiUnavailableError("The AI Assistant returned an unreadable response.");
    }

    return coerceAnalysis(parsed);
  } catch (error) {
    if (isGeminiUnavailableError(error)) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new GeminiUnavailableError("The AI Assistant took too long to respond.");
    }
    throw new GeminiUnavailableError(error instanceof Error ? error.message : "The AI Assistant is unavailable.");
  } finally {
    clearTimeout(timeout);
  }
}
