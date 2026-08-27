import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  Timestamp,
  type Firestore,
} from "firebase/firestore";
import { firestore as defaultFirestore } from "@/lib/firebase";
import {
  CASH_DEPOSIT_TYPE_LABELS,
  DEFAULT_BRANCH_ID,
  SUPPORTED_CASH_DEPOSIT_TYPES,
  generateLocalId,
  isValidDateKey,
  roundCurrency,
  toDateKey,
  toTimeKey,
  type CashDepositType,
  type FinanceAccount,
  type FinanceDailyClosing,
  type FinanceExpenseCategory,
  type FinanceIncomeCategory,
  type FinanceTransaction,
} from "@/lib/finance";
import {
  FINANCE_AI_CHAT_COLLECTION,
  FINANCE_AI_CHAT_SETTINGS_COLLECTION,
  type FinanceAiChatImageInput,
  type FinanceAiChatMessage,
  type FinanceAiChatSettings,
  type FinanceAiMatchSource,
  type FinanceAiProposedAction,
} from "@/lib/financeAiChat";
import { analyzeFinanceAiChatTurn, isGeminiUnavailableError, type FinanceAiChatAnalysis, type FinanceAiRawAction } from "@/lib/geminiFinanceAssistant";
import { payeeTextsLooselyMatch } from "@/lib/quickEntry";
import { formatCurrency } from "@/lib/financeFormat";
import { getExpenseCategories, getIncomeCategories } from "@/services/financeCategoriesService";
import { getFinanceAccounts } from "@/services/financeAccountsService";
import { getFinanceDashboardSummary, type FinanceDashboardSummary } from "@/services/financeDashboardService";
import {
  addDailyClosingDeposit,
  addDailyClosingExpense,
  closeDailyClosing,
  getDailyClosingsForRange,
  isDayLocked,
  reopenDailyClosing,
  updateDailyClosingSales,
} from "@/services/financeClosingService";
import { createFinanceTransaction, getPostedTransactionsForRange } from "@/services/financeTransactionsService";

// ─────────────────────────────────────────────────────────────────────────
// Finance AI Assistant chat — orchestration.
//
// Ties together the isolated Gemini client (lib/geminiFinanceAssistant.ts,
// extraction/classification ONLY — never writes anything) with the SAME
// existing mutation functions every other Finance feature already uses:
// addDailyClosingExpense / addDailyClosingDeposit / updateDailyClosingSales
// / closeDailyClosing (services/financeClosingService.ts) and
// createFinanceTransaction (services/financeTransactionsService.ts).
// Nothing here re-implements balance updates, category rollups, or the
// fin_daily_closing/fin_transactions schema — it only prepares inputs for
// those existing functions, and only once an admin explicitly approves one
// specific proposed action at a time (never automatically, never in bulk).
//
// Chat history lives in its own new collection (finance_ai_chat_messages,
// see lib/financeAiChat.ts), admin-only end to end. Screenshots themselves
// are never persisted — sent to Gemini for analysis, then discarded, same
// privacy stance Quick Entry already takes.
// ─────────────────────────────────────────────────────────────────────────

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGES_PER_TURN = 6;

function chatMessagesCollection(db: Firestore) {
  return collection(db, FINANCE_AI_CHAT_COLLECTION);
}

function chatSettingsCollection(db: Firestore) {
  return collection(db, FINANCE_AI_CHAT_SETTINGS_COLLECTION);
}

function toMillis(value: unknown): number {
  return value && typeof value === "object" && "seconds" in value ? (value as { seconds: number }).seconds * 1000 : 0;
}

function base64ByteLength(base64: string): number {
  const clean = base64.replace(/=+$/, "");
  return Math.floor((clean.length * 3) / 4);
}

/** Exact (case-insensitive) match first, then the same loose fuzzy matcher Quick Entry/Daily Closing image reading already use — the AI is told to choose only from the real list, but this is a safety net for near-misses (casing, trailing punctuation, minor spelling). */
function findCategoryMatch<T extends { name: string }>(categories: T[], name: string | null): T | null {
  if (!name) return null;
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  return (
    categories.find((c) => c.name.toLowerCase() === needle) ??
    categories.find((c) => payeeTextsLooselyMatch(name, c.name) || payeeTextsLooselyMatch(c.name, name)) ??
    null
  );
}

/** Last-resort fallback (same business rule as Daily Closing's "Read from Image"): default to an existing "Misc"-style category rather than leaving the row blank — still fully editable before approval. */
function findMiscCategory<T extends { name: string }>(categories: T[]): T | null {
  return categories.find((c) => /\bmisc(ellaneous)?\b/i.test(c.name)) ?? null;
}

function resolveCategory<T extends { id: string; name: string }>(
  categories: T[],
  aiName: string | null,
): { id: string | null; name: string | null; source: FinanceAiMatchSource } {
  const match = findCategoryMatch(categories, aiName);
  if (match) return { id: match.id, name: match.name, source: "ai" };
  const misc = findMiscCategory(categories);
  if (misc) return { id: misc.id, name: misc.name, source: "misc_fallback" };
  return { id: null, name: null, source: null };
}

function findAccountMatch(accounts: FinanceAccount[], name: string | null): FinanceAccount | null {
  if (!name) return null;
  return accounts.find((a) => a.status === "active" && (payeeTextsLooselyMatch(name, a.name) || payeeTextsLooselyMatch(a.name, name))) ?? null;
}

/** Matches the AI's free-text deposit type guess against SUPPORTED_CASH_DEPOSIT_TYPES by code or label. Falls back to the single supported type today ("pigmi") when nothing matches, since a deposit action wouldn't have been proposed at all otherwise — this stays generic if more types are added later (falls back to null instead, requiring the admin to pick one in review). */
function resolveDepositType(aiType: string | null): CashDepositType | null {
  if (aiType) {
    const needle = aiType.trim().toLowerCase();
    const match = SUPPORTED_CASH_DEPOSIT_TYPES.find(
      (type) => type === needle || payeeTextsLooselyMatch(aiType, CASH_DEPOSIT_TYPE_LABELS[type]) || payeeTextsLooselyMatch(CASH_DEPOSIT_TYPE_LABELS[type], aiType),
    );
    if (match) return match;
  }
  return SUPPORTED_CASH_DEPOSIT_TYPES.length === 1 ? SUPPORTED_CASH_DEPOSIT_TYPES[0] : null;
}

/**
 * Turns the Dashboard's own summary (services/financeDashboardService.ts —
 * the exact same numbers shown on the Finance Dashboard page, nothing
 * recomputed differently here) plus the raw account list into a compact
 * "right now" block for the AI prompt — today's figures and current
 * balances only. The fuller month-by-month/daily/category history lives in
 * buildFinanceHistorySnapshot below; together they're the ONLY data source
 * the assistant is allowed to answer informational questions from — see
 * buildPrompt in lib/geminiFinanceAssistant.ts. Every figure here is real
 * and fetched fresh for this exact chat turn, never cached across turns.
 */
function buildFinanceSnapshotText(summary: FinanceDashboardSummary, accounts: FinanceAccount[]): string {
  const c = summary.cards;
  const lines: string[] = [];

  lines.push(
    `Today: Cash Revenue ${formatCurrency(c.todayCashRevenue)}, Cash Expense ${formatCurrency(c.todayCashExpense)}, Pigmi Deposit ${formatCurrency(
      c.todayPigmiDeposit,
    )}, Total Revenue ${formatCurrency(c.todayTotalRevenue)}, Profit ${formatCurrency(c.todayProfit)}. (These read ₹0 until today's Daily Closing is saved.)`,
  );
  lines.push(
    `Balances right now: Cash on Hand ${formatCurrency(c.cashOnHand)} (the latest Daily Closing's Closing Cash — the real physical cash count), Bank Balance ${formatCurrency(
      c.bankBalance,
    )}, Pigmi Balance ${formatCurrency(c.pigmiBalance)}, Pending Settlements ${formatCurrency(
      c.pendingSettlements,
    )} (Zomato/Swiggy revenue already recognized but not yet settled into a bank account).`,
  );

  const activeAccounts = accounts.filter((a) => a.status === "active");
  if (activeAccounts.length > 0) {
    lines.push(`Individual account balances: ${activeAccounts.map((a) => `${a.name} (${a.type}) = ${formatCurrency(a.currentBalance)}`).join(", ")}.`);
  }

  return lines.join("\n");
}

/**
 * The FULL history, not just a recent window — every locked Daily Closing
 * day plus every non-cash-drawer, non-auto-posted ledger transaction (same
 * blending rule as the Dashboard/getFinanceHistoryRange: Daily Closing owns
 * cash, bank-side transactions add on top, nothing double-counted), rolled
 * up into month-by-month totals with each month's top expense categories
 * (so the assistant can actually compare "this month vs last month" and
 * spot where spending changed), plus day-by-day detail for the most recent
 * stretch (so it can also answer specific-date questions like "what did I
 * spend on the 16th"). Bounded to the last 60 days of DAILY detail only to
 * keep the prompt a sane size as history grows over years — the monthly
 * rollups above that window are unbounded and cover the entire history.
 */
function buildFinanceHistorySnapshot(closings: FinanceDailyClosing[], transactions: FinanceTransaction[], accounts: FinanceAccount[]): string {
  const accountTypeById = new Map(accounts.map((a) => [a.id, a.type]));
  const isCashAccount = (id: string | null) => (id ? accountTypeById.get(id) === "cash" : false);

  // Same rule as financeDashboardService.ts: a transaction Daily Closing
  // itself generated is already inside that day's totalRevenue/
  // cashExpenseTotal below — counting it again here would double it.
  const notDailyClosingGenerated = transactions.filter((t) => t.autoPostedSource !== "daily_closing");
  const bankIncome = notDailyClosingGenerated.filter((t) => t.type === "income" && !isCashAccount(t.toAccountId));
  const bankExpense = notDailyClosingGenerated.filter((t) => t.type === "expense" && !isCashAccount(t.fromAccountId));
  const lockedClosings = closings.filter((c) => c.locked);

  if (lockedClosings.length === 0 && bankIncome.length === 0 && bankExpense.length === 0) {
    return "No closed Daily Closing days or bank transactions recorded yet — there's no history to analyze.";
  }

  const dayTotals = new Map<string, { revenue: number; expense: number }>();
  const monthTotals = new Map<string, { revenue: number; expense: number }>();
  const monthCategories = new Map<string, Map<string, number>>();

  const addDay = (date: string, revenue: number, expense: number) => {
    const d = dayTotals.get(date) ?? { revenue: 0, expense: 0 };
    d.revenue = roundCurrency(d.revenue + revenue);
    d.expense = roundCurrency(d.expense + expense);
    dayTotals.set(date, d);

    const month = date.slice(0, 7);
    const m = monthTotals.get(month) ?? { revenue: 0, expense: 0 };
    m.revenue = roundCurrency(m.revenue + revenue);
    m.expense = roundCurrency(m.expense + expense);
    monthTotals.set(month, m);
  };
  const addCategory = (date: string, categoryName: string, amount: number) => {
    const month = date.slice(0, 7);
    const cats = monthCategories.get(month) ?? new Map<string, number>();
    cats.set(categoryName, roundCurrency((cats.get(categoryName) ?? 0) + amount));
    monthCategories.set(month, cats);
  };

  for (const c of lockedClosings) {
    addDay(c.date, c.totalRevenue, c.cashExpenseTotal);
    for (const e of c.expenses) addCategory(c.date, e.categoryName, e.amount);
  }
  for (const t of bankIncome) addDay(t.date, t.amount, 0);
  for (const t of bankExpense) {
    addDay(t.date, 0, t.amount);
    addCategory(t.date, t.categoryName ?? "Uncategorized", t.amount);
  }

  const sortedMonths = Array.from(monthTotals.keys()).sort();
  const allTimeRevenue = roundCurrency(Array.from(monthTotals.values()).reduce((sum, m) => sum + m.revenue, 0));
  const allTimeExpense = roundCurrency(Array.from(monthTotals.values()).reduce((sum, m) => sum + m.expense, 0));

  const lines: string[] = [];
  lines.push(
    `Full recorded history: ${sortedMonths[0]} through ${sortedMonths[sortedMonths.length - 1]}. All-time totals: Revenue ${formatCurrency(
      allTimeRevenue,
    )}, Expense ${formatCurrency(allTimeExpense)}, Profit ${formatCurrency(roundCurrency(allTimeRevenue - allTimeExpense))}.`,
  );

  lines.push("Month-by-month, oldest to newest (revenue / expense / profit, then that month's top expense categories):");
  for (const month of sortedMonths) {
    const m = monthTotals.get(month)!;
    const profit = roundCurrency(m.revenue - m.expense);
    const topCats = Array.from((monthCategories.get(month) ?? new Map()).entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, amount]) => `${name} ${formatCurrency(amount)}`)
      .join(", ");
    lines.push(`${month}: ${formatCurrency(m.revenue)} / ${formatCurrency(m.expense)} / ${formatCurrency(profit)}.${topCats ? ` Top categories: ${topCats}.` : ""}`);
  }

  const sortedDays = Array.from(dayTotals.keys()).sort();
  const recentDays = sortedDays.slice(-60);
  lines.push(`Daily detail, most recent ${recentDays.length} day(s) with activity (date: revenue / expense / profit):`);
  lines.push(
    recentDays
      .map((date) => {
        const d = dayTotals.get(date)!;
        return `${date}: ${formatCurrency(d.revenue)} / ${formatCurrency(d.expense)} / ${formatCurrency(roundCurrency(d.revenue - d.expense))}`;
      })
      .join("; "),
  );

  return lines.join("\n");
}

interface ResolveContext {
  expenseCategories: FinanceExpenseCategory[];
  incomeCategories: FinanceIncomeCategory[];
  accounts: FinanceAccount[];
  todayKey: string;
}

/** Turns one untrusted AI-proposed action into a fully-resolved FinanceAiProposedAction, or null if it's unusable (missing amount, unclassifiable kind, etc.) and should be silently dropped rather than shown as a blank card. Every category/account/deposit-type is resolved against the REAL existing lists here — never trusted from the AI's free text directly. */
function resolveAction(raw: FinanceAiRawAction, ctx: ResolveContext): FinanceAiProposedAction | null {
  const id = generateLocalId();
  const rawDate = raw.date && isValidDateKey(raw.date) && raw.date <= ctx.todayKey ? raw.date : ctx.todayKey;

  if (raw.kind === "daily_closing_field") {
    if (!raw.field) return null;

    if (raw.field === "expense") {
      if (!raw.expenseAmount || raw.expenseAmount <= 0) return null;
      const resolved = resolveCategory(ctx.expenseCategories, raw.expenseCategoryName);
      return {
        id,
        kind: "daily_closing_field",
        sourceImageIndex: raw.sourceImageIndex,
        reasoning: raw.reasoning,
        confidence: raw.confidence,
        categorySource: resolved.source,
        accountSource: null,
        dailyClosing: {
          date: rawDate,
          field: "expense",
          value: null,
          expenseCategoryId: resolved.id,
          expenseCategoryName: resolved.name ?? raw.expenseCategoryName,
          expenseAmount: roundCurrency(raw.expenseAmount),
          expenseRemarks: raw.expenseRemarks ?? "",
          depositType: null,
          depositAmount: null,
          depositRemarks: "",
        },
        transaction: null,
        status: "pending",
        resultRef: null,
        errorMessage: null,
        resolvedNote: null,
      };
    }

    if (raw.field === "deposit") {
      if (!raw.depositAmount || raw.depositAmount <= 0) return null;
      return {
        id,
        kind: "daily_closing_field",
        sourceImageIndex: raw.sourceImageIndex,
        reasoning: raw.reasoning,
        confidence: raw.confidence,
        categorySource: null,
        accountSource: null,
        dailyClosing: {
          date: rawDate,
          field: "deposit",
          value: null,
          expenseCategoryId: null,
          expenseCategoryName: null,
          expenseAmount: null,
          expenseRemarks: "",
          depositType: resolveDepositType(raw.depositType),
          depositAmount: roundCurrency(raw.depositAmount),
          depositRemarks: raw.depositRemarks ?? "",
        },
        transaction: null,
        status: "pending",
        resultRef: null,
        errorMessage: null,
        resolvedNote: null,
      };
    }

    // Scalar fields: closingCash / upiSales / zomatoSales / swiggySales / otherIncome
    if (raw.value === null || raw.value === undefined || !Number.isFinite(raw.value)) return null;
    const value = raw.field === "closingCash" ? roundCurrency(raw.value) : Math.max(0, roundCurrency(raw.value));
    return {
      id,
      kind: "daily_closing_field",
      sourceImageIndex: raw.sourceImageIndex,
      reasoning: raw.reasoning,
      confidence: raw.confidence,
      categorySource: null,
      accountSource: null,
      dailyClosing: {
        date: rawDate,
        field: raw.field,
        value,
        expenseCategoryId: null,
        expenseCategoryName: null,
        expenseAmount: null,
        expenseRemarks: "",
        depositType: null,
        depositAmount: null,
        depositRemarks: "",
      },
      transaction: null,
      status: "pending",
      resultRef: null,
      errorMessage: null,
      resolvedNote: null,
    };
  }

  if (raw.kind === "transaction") {
    if (!raw.transactionType || !raw.amount || raw.amount <= 0) return null;

    let categoryId: string | null = null;
    let categoryName: string | null = null;
    let categorySource: FinanceAiMatchSource = null;
    if (raw.transactionType === "expense") {
      const resolved = resolveCategory(ctx.expenseCategories, raw.categoryName);
      categoryId = resolved.id;
      categoryName = resolved.name ?? raw.categoryName;
      categorySource = resolved.source;
    } else if (raw.transactionType === "income") {
      const resolved = resolveCategory(ctx.incomeCategories, raw.categoryName);
      categoryId = resolved.id;
      categoryName = resolved.name ?? raw.categoryName;
      categorySource = resolved.source;
    }

    const fromAccount = findAccountMatch(ctx.accounts, raw.fromAccountName);
    const toAccount = findAccountMatch(ctx.accounts, raw.toAccountName);

    return {
      id,
      kind: "transaction",
      sourceImageIndex: raw.sourceImageIndex,
      reasoning: raw.reasoning,
      confidence: raw.confidence,
      categorySource,
      accountSource: fromAccount || toAccount ? "ai" : null,
      dailyClosing: null,
      transaction: {
        type: raw.transactionType,
        date: rawDate,
        time: raw.time ?? toTimeKey(),
        amount: roundCurrency(raw.amount),
        categoryId,
        categoryName,
        fromAccountId: fromAccount?.id ?? null,
        fromAccountName: fromAccount?.name ?? raw.fromAccountName,
        toAccountId: toAccount?.id ?? null,
        toAccountName: toAccount?.name ?? raw.toAccountName,
        remarks: raw.remarks ?? "",
        referenceNumber: raw.referenceNumber ?? "",
      },
      status: "pending",
      resultRef: null,
      errorMessage: null,
      resolvedNote: null,
    };
  }

  return null;
}

export interface SendFinanceAiChatMessageInput {
  text: string;
  images: FinanceAiChatImageInput[];
  branchId?: string;
}

/**
 * One full chat turn: validates the input, records the admin's own message,
 * gathers the current real category/account/deposit-type lists as AI
 * context, calls Gemini, resolves every proposed action against those real
 * lists, and records the assistant's reply (with its proposed actions,
 * every one of them status "pending"). Never writes to fin_daily_closing/
 * fin_transactions itself — see resolveFinanceAiAction for that.
 */
export async function sendFinanceAiChatMessage(
  input: SendFinanceAiChatMessageInput,
  userId: string,
  userName: string,
  db: Firestore = defaultFirestore,
): Promise<{ userMessage: FinanceAiChatMessage; assistantMessage: FinanceAiChatMessage }> {
  const branchId = input.branchId ?? DEFAULT_BRANCH_ID;
  const text = input.text?.trim() ?? "";
  const images = input.images ?? [];

  if (!text && images.length === 0) throw new Error("Type a message or attach at least one image.");
  if (images.length > MAX_IMAGES_PER_TURN) throw new Error(`Please attach at most ${MAX_IMAGES_PER_TURN} images at a time.`);
  for (const img of images) {
    const mimeType = img.mimeType?.toLowerCase();
    if (!mimeType || !ALLOWED_MIME_TYPES.has(mimeType)) throw new Error("Unsupported image type — please upload a JPG, PNG, or WEBP image.");
    if (!img.base64Data) throw new Error("One of the images has no data.");
    if (base64ByteLength(img.base64Data) > MAX_IMAGE_BYTES) throw new Error("One of the images is too large — please upload photos under 8MB each.");
  }

  const userMessageRef = doc(chatMessagesCollection(db));
  const userMessage: FinanceAiChatMessage = {
    id: userMessageRef.id,
    role: "user",
    text,
    imageCount: images.length,
    proposedActions: [],
    branchId,
    createdBy: userId,
    createdByName: userName,
  };
  await setDoc(userMessageRef, { ...userMessage, createdAt: serverTimestamp() });

  const todayKey = toDateKey();
  const [expenseCategories, incomeCategories, accounts, dashboardSummary, allClosings, allTransactions] = await Promise.all([
    getExpenseCategories({ branchId }, db),
    getIncomeCategories({ branchId }, db),
    getFinanceAccounts({ branchId }, db),
    getFinanceDashboardSummary(db, branchId),
    getDailyClosingsForRange("2000-01-01", todayKey, db, branchId),
    getPostedTransactionsForRange("2000-01-01", todayKey, db, branchId),
  ]);

  let analysis: FinanceAiChatAnalysis;
  try {
    analysis = await analyzeFinanceAiChatTurn(text, images, {
      todayDate: todayKey,
      expenseCategoryNames: expenseCategories.map((c) => c.name),
      incomeCategoryNames: incomeCategories.map((c) => c.name),
      accountNames: accounts.filter((a) => a.status === "active").map((a) => a.name),
      depositTypeLabels: SUPPORTED_CASH_DEPOSIT_TYPES.map((t) => CASH_DEPOSIT_TYPE_LABELS[t]),
      financeSnapshot: `${buildFinanceSnapshotText(dashboardSummary, accounts)}\n\n${buildFinanceHistorySnapshot(allClosings, allTransactions, accounts)}`,
    });
  } catch (error) {
    analysis = {
      assistantSummary: isGeminiUnavailableError(error) ? error.message : "I couldn't process that — please try again or enter it manually.",
      actions: [],
    };
  }

  const proposedActions = analysis.actions
    .map((raw) => resolveAction(raw, { expenseCategories, incomeCategories, accounts, todayKey }))
    .filter((a): a is FinanceAiProposedAction => a !== null);

  const assistantMessageRef = doc(chatMessagesCollection(db));
  const assistantMessage: FinanceAiChatMessage = {
    id: assistantMessageRef.id,
    role: "assistant",
    text: analysis.assistantSummary,
    imageCount: 0,
    proposedActions,
    branchId,
    createdBy: userId,
    createdByName: userName,
  };
  await setDoc(assistantMessageRef, { ...assistantMessage, createdAt: serverTimestamp() });

  const now = Timestamp.now();
  return {
    userMessage: { ...userMessage, createdAt: now },
    assistantMessage: { ...assistantMessage, createdAt: now },
  };
}

export interface FinanceAiActionEdits {
  date?: string;
  value?: number;
  expenseCategoryId?: string;
  expenseAmount?: number;
  expenseRemarks?: string;
  depositType?: CashDepositType;
  depositAmount?: number;
  depositRemarks?: string;
  amount?: number;
  time?: string;
  categoryId?: string;
  fromAccountId?: string;
  toAccountId?: string;
  remarks?: string;
  referenceNumber?: string;
}

export interface ResolveFinanceAiActionInput {
  messageId: string;
  actionId: string;
  decision: "approve" | "discard";
  edits?: FinanceAiActionEdits;
  branchId?: string;
}

/**
 * Approves or discards ONE proposed action. Discarding never touches the
 * ledger. Approving dispatches to the EXISTING mutation functions — see the
 * file header. `edits` lets the admin correct anything (amount, date,
 * category, account, deposit type, ...) right before it's saved, same
 * "review, don't just trust the AI" principle as every other Finance AI
 * feature. On failure (e.g. the target day is already closed and locked),
 * the action is marked "failed" with the real error message attached and
 * the error is re-thrown so the API/caller can surface it — nothing is
 * left silently "pending" forever, but nothing partial is left in the
 * ledger either, since the underlying functions are themselves atomic.
 */
export async function resolveFinanceAiAction(
  input: ResolveFinanceAiActionInput,
  userId: string,
  userName: string,
  db: Firestore = defaultFirestore,
): Promise<FinanceAiProposedAction> {
  const branchId = input.branchId ?? DEFAULT_BRANCH_ID;
  const messageRef = doc(chatMessagesCollection(db), input.messageId);
  const snap = await getDoc(messageRef);
  if (!snap.exists()) throw new Error("This chat message no longer exists.");

  const message = snap.data() as Omit<FinanceAiChatMessage, "id">;
  const actions = [...(message.proposedActions ?? [])];
  const index = actions.findIndex((a) => a.id === input.actionId);
  if (index === -1) throw new Error("This action no longer exists.");

  const action = actions[index];
  // "failed" stays retryable (approve again, possibly with corrected edits) —
  // only "approved"/"discarded" are truly final states.
  if (action.status === "approved" || action.status === "discarded") {
    throw new Error(`This action was already ${action.status}.`);
  }

  if (input.decision === "discard") {
    actions[index] = {
      ...action,
      status: "discarded",
      resolvedNote: null,
      resolvedAt: serverTimestamp() as never,
      resolvedBy: userId,
      resolvedByName: userName,
    };
    await updateDoc(messageRef, { proposedActions: actions });
    return actions[index];
  }

  const edits = input.edits ?? {};
  let resultRef: string | null = null;
  let resolvedNote: string | null = null;

  try {
    if (action.kind === "daily_closing_field") {
      const dc = action.dailyClosing;
      if (!dc) throw new Error("This action is missing its Daily Closing details.");
      const date = edits.date && isValidDateKey(edits.date) ? edits.date : dc.date;
      // Truthful, specific reason for the reopen audit trail — matches the
      // existing "reopen is a real, audited correction" convention (see
      // reopenDailyClosing), not a silent bypass of it.
      const reopenReason = `AI Assistant correction: ${action.reasoning}`.slice(0, 300);

      if (dc.field === "closingCash") {
        const value = edits.value ?? dc.value;
        if (value === null || value === undefined || !Number.isFinite(value)) throw new Error("Enter a valid Closing Cash value.");
        // Unlike every other case here, this doesn't just update a draft field —
        // it CLOSES AND LOCKS the day (closeDailyClosing is the only function
        // that writes closingCash at all). The review UI must make this
        // unmistakable before an admin reaches this point. If the day was
        // ALREADY closed (e.g. correcting a wrong photo/date), reopen it
        // first — closeDailyClosing then both applies the new value and
        // re-locks in the same call, so no separate re-close step is needed.
        const wasLockedForClosingCash = await isDayLocked(date, db);
        if (wasLockedForClosingCash) await reopenDailyClosing(date, userId, userName, reopenReason, db);
        await closeDailyClosing(date, value, userId, userName, db, branchId);
        resultRef = date;
        resolvedNote = wasLockedForClosingCash ? `${date} was already closed — reopened, corrected, and re-closed.` : null;
        actions[index] = {
          ...action,
          status: "approved",
          resultRef,
          errorMessage: null,
          resolvedNote,
          resolvedAt: serverTimestamp() as never,
          resolvedBy: userId,
          resolvedByName: userName,
        };
        await updateDoc(messageRef, { proposedActions: actions });
        return actions[index];
      }

      // expense / deposit / a scalar sales figure: none of these functions
      // touch a locked day at all (addDailyClosingExpense/addDailyClosingDeposit
      // throw outright; updateDailyClosingSales has no lock check of its own).
      // The user's core "correct yesterday's UPI Sales from this morning's
      // settlement screenshot" scenario needs exactly this: yesterday is
      // almost always ALREADY closed by the time the screenshot arrives. So:
      // reopen (a real, audited correction) → apply the change → re-close
      // with the SAME Closing Cash as before (never inventing a new one),
      // always in a finally block so the day is never left stuck open.
      const wasLocked = await isDayLocked(date, db);
      let closingCashToRestore: number | null = null;
      if (wasLocked) {
        const [current] = await getDailyClosingsForRange(date, date, db, branchId);
        closingCashToRestore = current?.closingCash ?? null;
        await reopenDailyClosing(date, userId, userName, reopenReason, db);
      }
      try {
        if (dc.field === "expense") {
          const categoryId = edits.expenseCategoryId ?? dc.expenseCategoryId;
          if (!categoryId) throw new Error("Choose an expense category before approving.");
          const amount = edits.expenseAmount ?? dc.expenseAmount;
          if (!amount || amount <= 0) throw new Error("Enter a valid amount.");
          await addDailyClosingExpense(date, { categoryId, amount, remarks: edits.expenseRemarks ?? dc.expenseRemarks }, userId, userName, db, branchId);
        } else if (dc.field === "deposit") {
          const depositType = edits.depositType ?? dc.depositType;
          if (!depositType) throw new Error("Choose a deposit type before approving.");
          const amount = edits.depositAmount ?? dc.depositAmount;
          if (!amount || amount <= 0) throw new Error("Enter a valid amount.");
          await addDailyClosingDeposit(date, { type: depositType, amount, remarks: edits.depositRemarks ?? dc.depositRemarks }, userId, userName, db, branchId);
        } else {
          const value = edits.value ?? dc.value;
          if (value === null || value === undefined || !Number.isFinite(value)) throw new Error("Enter a valid amount.");
          await updateDailyClosingSales(date, { [dc.field]: value }, db, branchId);
        }
        resultRef = date;
      } finally {
        if (wasLocked && closingCashToRestore !== null) {
          await closeDailyClosing(date, closingCashToRestore, userId, userName, db, branchId).catch((err) => {
            console.error("[financeAiChatService] Failed to re-close after an AI Assistant correction — the day may be left unlocked; check Lock Settings.", err);
          });
        }
      }
      resolvedNote = wasLocked ? `${date} was already closed — reopened, corrected, and re-closed.` : null;
    } else if (action.kind === "transaction") {
      const t = action.transaction;
      if (!t) throw new Error("This action is missing its transaction details.");
      const date = edits.date && isValidDateKey(edits.date) ? edits.date : t.date;
      const amount = edits.amount ?? t.amount;
      if (!amount || amount <= 0) throw new Error("Enter a valid amount.");

      const created = await createFinanceTransaction(
        {
          type: t.type,
          date,
          time: edits.time ?? t.time,
          categoryId: edits.categoryId ?? t.categoryId ?? undefined,
          description: t.remarks || "Recorded via AI Assistant",
          amount,
          fromAccountId: edits.fromAccountId ?? t.fromAccountId ?? undefined,
          toAccountId: edits.toAccountId ?? t.toAccountId ?? undefined,
          remarks: [edits.remarks ?? t.remarks, "Recorded via AI Assistant"].filter(Boolean).join(" · "),
          referenceNumber: edits.referenceNumber ?? t.referenceNumber,
          branchId,
        },
        userId,
        userName,
        db,
      );
      resultRef = created.id;
    } else {
      throw new Error("Unknown action kind.");
    }

    actions[index] = {
      ...action,
      status: "approved",
      resultRef,
      errorMessage: null,
      resolvedNote,
      resolvedAt: serverTimestamp() as never,
      resolvedBy: userId,
      resolvedByName: userName,
    };
    await updateDoc(messageRef, { proposedActions: actions });
    return actions[index];
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Something went wrong while saving this.";
    actions[index] = {
      ...action,
      status: "failed",
      errorMessage,
      resolvedNote: null,
      resolvedAt: serverTimestamp() as never,
      resolvedBy: userId,
      resolvedByName: userName,
    };
    await updateDoc(messageRef, { proposedActions: actions });
    throw error;
  }
}

/** Chat history, oldest first, for the shared admin thread (branch-scoped, not per-admin — this is a single-restaurant tool, same "everyone sees everything" convention as Quick Entry's own Admin activity view). Sorted in memory to avoid needing a new composite index, same trade-off as getQuickEntryActivity. Hides anything at or before the branch's clearFinanceAiChatHistory cursor, if one has ever been set. */
export async function getFinanceAiChatHistory(
  db: Firestore = defaultFirestore,
  branchId: string = DEFAULT_BRANCH_ID,
  limitCount = 100,
): Promise<FinanceAiChatMessage[]> {
  const [snapshot, settingsSnap] = await Promise.all([
    getDocs(query(chatMessagesCollection(db), where("branchId", "==", branchId))),
    getDoc(doc(chatSettingsCollection(db), branchId)),
  ]);
  const clearedBeforeMs = settingsSnap.exists() ? toMillis((settingsSnap.data() as FinanceAiChatSettings).clearedBefore) : 0;

  const rows = snapshot.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<FinanceAiChatMessage, "id">) }))
    .filter((m) => toMillis(m.createdAt) > clearedBeforeMs);
  rows.sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
  return rows.slice(-limitCount);
}

/**
 * Non-destructive "clear chat": moves the branch's cursor forward to now, so
 * getFinanceAiChatHistory stops returning anything older than this moment.
 * Every message doc — and every real Daily Closing/transaction write any
 * already-approved action produced — is untouched and stays in Firestore,
 * same "archive, don't delete" principle as the rest of this module.
 */
export async function clearFinanceAiChatHistory(
  userId: string,
  userName: string,
  db: Firestore = defaultFirestore,
  branchId: string = DEFAULT_BRANCH_ID,
): Promise<void> {
  const settings: FinanceAiChatSettings = { branchId, clearedBy: userId, clearedByName: userName };
  await setDoc(doc(chatSettingsCollection(db), branchId), { ...settings, clearedBefore: serverTimestamp() }, { merge: true });
}
