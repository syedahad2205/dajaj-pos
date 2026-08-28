import type { Firestore } from "firebase/firestore";
import { firestore as defaultFirestore } from "@/lib/firebase";
import { DEFAULT_BRANCH_ID, depositEventKey, roundCurrency, toDateKey, type FinanceDailyClosing } from "@/lib/finance";
import { buildPlatformDayInfo, lookupPlatformDayInfo } from "@/lib/platformRevenue";
import { getDailyClosingsForRange } from "@/services/financeClosingService";
import { getFinanceAccounts } from "@/services/financeAccountsService";
import { getFinanceDefaultsMap } from "@/services/financeDefaultsService";
import { getPostedTransactionsForRange } from "@/services/financeTransactionsService";
import { getZomatoImports, getItemSalesForDateRange } from "@/services/zomatoService";
import { getSwiggyImports, getSwiggyItemSalesForDateRange } from "@/services/swiggyService";

/** Sum of one deposit type (e.g. Pigmi) across a set of Daily Closing days. Extending to other deposit types later just means calling this with a different type. */
function sumDepositsOfType(closings: FinanceDailyClosing[], type: string): number {
  return roundCurrency(
    closings.reduce((sum, c) => sum + c.deposits.filter((d) => d.type === type).reduce((s, d) => s + d.amount, 0), 0),
  );
}

export interface FinanceDashboardCards {
  todayCashRevenue: number;
  todayCashExpense: number;
  todayPigmiDeposit: number;
  todayTotalRevenue: number;
  todayProfit: number;
  cashOnHand: number;
  pigmiBalance: number;
  bankBalance: number;
  /** Sum of active Escrow-type account balances — revenue recognized (e.g. via Daily Closing's Zomato/Swiggy Sales) but not yet settled into a real bank account. */
  pendingSettlements: number;
  monthlyRevenue: number;
  monthlyExpense: number;
  monthlyProfit: number;
}

export interface FinanceDashboardTrendPoint {
  date: string;
  revenue: number;
  expense: number;
  netCashFlow: number;
}

export interface FinanceDashboardBreakdownItem {
  label: string;
  amount: number;
}

export interface FinanceDashboardSummary {
  cards: FinanceDashboardCards;
  revenueExpenseTrend: FinanceDashboardTrendPoint[];
  categoryWiseExpenses: FinanceDashboardBreakdownItem[];
  incomeSources: FinanceDashboardBreakdownItem[];
  topExpenseCategories: FinanceDashboardBreakdownItem[];
}

function firstDayOfMonth(date: Date): string {
  return toDateKey(new Date(date.getFullYear(), date.getMonth(), 1));
}

function sumByLabel(items: Array<{ label: string; amount: number }>): FinanceDashboardBreakdownItem[] {
  const totals = new Map<string, number>();
  for (const item of items) {
    totals.set(item.label, roundCurrency((totals.get(item.label) ?? 0) + item.amount));
  }
  return Array.from(totals.entries())
    .map(([label, amount]) => ({ label, amount }))
    .filter((item) => item.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

/**
 * The Dashboard blends two sources on purpose:
 *
 * 1. Daily Closing (fin_daily_closing) — the cash drawer register. This is
 *    the sole source for "Today" cards and Cash on Hand; it's never
 *    recomputed from the ledger (Daily Closing intentionally stays a
 *    self-contained, physically-counted plug figure). NOTE: "Today" is a
 *    same-day snapshot and deliberately does NOT settlement-gate Zomato/
 *    Swiggy — a single day is too soon to have a payout anyway, so it just
 *    shows Daily Closing's raw entry, same as it always has.
 * 2. Transactions (fin_transactions) — bank payments, settlements, and
 *    transfers recorded on the Transactions tab. These feed Monthly
 *    Revenue/Expense, the trend chart, and the category/income breakdowns,
 *    but only for non-Cash-Drawer accounts: any ledger entry tagged to a
 *    `type === "cash"` account is excluded from these merges, since Daily
 *    Closing already fully owns cash-drawer accounting for that money.
 *    Transfers never affect revenue/expense (same rule as always).
 *
 * Zomato/Swiggy revenue within Monthly Revenue/Profit, the 14-day trend, and
 * the income-source breakdown is settlement-gated exactly like the P&L
 * report (Reports tab) — via the shared lib/platformRevenue.ts helper. A
 * day's Zomato/Swiggy sales count as ₹0 profit-wise until that week's payout
 * is actually recorded, at which point the GROSS daily figure counts (with
 * the commission landing separately as a "Settlement Deduction" expense via
 * the Transactions merge above) — see the big comment in
 * lib/platformRevenue.ts for why this must be gross, not net.
 */
export async function getFinanceDashboardSummary(
  db: Firestore = defaultFirestore,
  branchId: string = DEFAULT_BRANCH_ID,
  referenceDate: Date = new Date(),
): Promise<FinanceDashboardSummary> {
  const todayKey = toDateKey(referenceDate);
  const monthStartKey = firstDayOfMonth(referenceDate);
  const trendStart = new Date(referenceDate);
  trendStart.setDate(trendStart.getDate() - 13);
  const trendStartKey = toDateKey(trendStart);
  const rangeStartKey = trendStartKey < monthStartKey ? trendStartKey : monthStartKey;

  const [rangeClosings, allTimeClosings, accounts, rangeTransactions, defaultsMap, zomatoImports, swiggyImports, zomatoItemSales, swiggyItemSales] =
    await Promise.all([
      getDailyClosingsForRange(rangeStartKey, todayKey, db, branchId),
      getDailyClosingsForRange("2000-01-01", todayKey, db, branchId),
      getFinanceAccounts({ branchId }, db),
      getPostedTransactionsForRange(rangeStartKey, todayKey, db, branchId),
      getFinanceDefaultsMap(db, branchId),
      getZomatoImports(db),
      getSwiggyImports(db),
      getItemSalesForDateRange(rangeStartKey, todayKey, db),
      getSwiggyItemSalesForDateRange(rangeStartKey, todayKey, db),
    ]);

  const zomatoClosingGrossByDate = new Map(rangeClosings.map((c) => [c.date, c.zomatoSales]));
  const swiggyClosingGrossByDate = new Map(rangeClosings.map((c) => [c.date, c.swiggySales]));
  const zomatoByDate = buildPlatformDayInfo(zomatoImports, zomatoItemSales, zomatoClosingGrossByDate);
  const swiggyByDate = buildPlatformDayInfo(swiggyImports, swiggyItemSales, swiggyClosingGrossByDate);
  // Settlement-gated GROSS revenue for a closed day — ₹0 until that week's
  // payout is settled. Same helper, same rule as the P&L report.
  const platformActualRevenueForDate = (date: string): number =>
    roundCurrency(
      lookupPlatformDayInfo(zomatoByDate, date).actualNet + lookupPlatformDayInfo(swiggyByDate, date).actualNet,
    );
  const zomatoActualRevenueForDate = (date: string): number => lookupPlatformDayInfo(zomatoByDate, date).actualNet;
  const swiggyActualRevenueForDate = (date: string): number => lookupPlatformDayInfo(swiggyByDate, date).actualNet;
  // A closing's non-platform revenue (cash + UPI + other) — the part of
  // totalRevenue that's never settlement-gated.
  const nonPlatformRevenue = (c: FinanceDailyClosing): number =>
    roundCurrency(c.totalRevenue - c.zomatoSales - c.swiggySales);

  const accountTypeById = new Map(accounts.map((a) => [a.id, a.type]));
  const isCashAccount = (accountId: string | null) => (accountId ? accountTypeById.get(accountId) === "cash" : false);

  // Two reasons a ledger transaction is excluded from the "bank activity" merge below:
  // 1. It's tagged to the Cash Drawer — Daily Closing already owns that money.
  // 2. It's autoPostedSource "daily_closing" — Daily Closing generated it itself
  //    (via Finance Defaults), so its amount is already sitting inside that
  //    day's cashRevenue/upiSales/zomatoSales/etc. Counting it again here
  //    would double it. Zomato settlement postings (autoPostedSource
  //    "zomato_settlement") are deliberately NOT excluded — the deduction/
  //    adjustment they post is genuinely new information about real profit,
  //    not money already counted elsewhere. Manually-entered Transactions
  //    tab rows (autoPosted false) also flow through as before.
  const notDailyClosingGenerated = rangeTransactions.filter((t) => t.autoPostedSource !== "daily_closing");
  const bankIncome = notDailyClosingGenerated.filter((t) => t.type === "income" && !isCashAccount(t.toAccountId));
  const bankExpense = notDailyClosingGenerated.filter((t) => t.type === "expense" && !isCashAccount(t.fromAccountId));

  const todayClosing = rangeClosings.find((c) => c.date === todayKey) ?? null;
  const lastLocked = [...allTimeClosings].reverse().find((c) => c.locked && typeof c.closingCash === "number");

  const cashOnHand = lastLocked?.closingCash ?? 0;
  // The Pigmi account's own ledger balance — NOT a re-sum of deposits from Daily Closing history.
  // That raw sum ignores anything that happened to the money afterwards (a withdrawal from the
  // Pigmi account, its opening balance, a voided/edited posting), so it can drift from the real
  // balance shown on the Accounts page. currentBalance is the single source of truth, same as
  // bankBalance/pendingSettlements below. NOTE: which account this money actually lives in is
  // decided by Finance Defaults' "pigmi_deposit" mapping (e.g. an account named "Unity"), NOT by
  // that account's own `type` field — accounts can be typed "cash"/"bank"/etc. regardless of what
  // they're actually used for, so this must look up the mapped destination account by id, not
  // filter accounts by `type === "pigmi"`.
  const pigmiAccountId = defaultsMap.get(depositEventKey("pigmi"))?.destinationAccountId ?? null;
  const pigmiAccount = pigmiAccountId ? accounts.find((a) => a.id === pigmiAccountId && a.status === "active") : undefined;
  const pigmiBalance = roundCurrency(pigmiAccount?.currentBalance ?? 0);
  const bankBalance = roundCurrency(accounts.filter((a) => a.status === "active" && a.type === "bank").reduce((sum, a) => sum + a.currentBalance, 0));
  const pendingSettlements = roundCurrency(accounts.filter((a) => a.status === "active" && a.type === "escrow").reduce((sum, a) => sum + a.currentBalance, 0));

  const todayCashRevenue = todayClosing?.locked ? todayClosing.cashRevenue : 0;
  const todayCashExpense = todayClosing?.cashExpenseTotal ?? 0;
  const todayPigmiDeposit = todayClosing ? sumDepositsOfType([todayClosing], "pigmi") : 0;
  const todayTotalRevenue = todayClosing?.locked ? todayClosing.totalRevenue : 0;
  const todayProfit = roundCurrency(todayTotalRevenue - todayCashExpense);

  const monthClosings = rangeClosings.filter((c) => c.date >= monthStartKey && c.date <= todayKey && c.locked);
  const monthBankIncome = bankIncome.filter((t) => t.date >= monthStartKey && t.date <= todayKey);
  const monthBankExpense = bankExpense.filter((t) => t.date >= monthStartKey && t.date <= todayKey);

  // Revenue = non-platform Daily Closing revenue (always immediate) +
  // Zomato/Swiggy revenue gated on settlement (₹0 until that week's payout
  // is recorded) + bank/ledger income (which already includes Settlement
  // Adjustment income when a payout comes in higher than recognized).
  const monthlyRevenue = roundCurrency(
    monthClosings.reduce((sum, c) => sum + nonPlatformRevenue(c) + platformActualRevenueForDate(c.date), 0) +
      monthBankIncome.reduce((sum, t) => sum + t.amount, 0),
  );
  // Expense is untouched by settlement-gating: cashExpenseTotal is
  // unrelated to Zomato/Swiggy, and bank/ledger expense already includes
  // the Settlement Deduction expense that nets against the gated revenue
  // above — same identity as the P&L report (Revenue gross − Deduction
  // expense = real payout, no double-counting).
  const monthlyExpense = roundCurrency(
    monthClosings.reduce((sum, c) => sum + c.cashExpenseTotal, 0) + monthBankExpense.reduce((sum, t) => sum + t.amount, 0),
  );
  const monthlyProfit = roundCurrency(monthlyRevenue - monthlyExpense);

  const trendDays: FinanceDashboardTrendPoint[] = [];
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() - i);
    const key = toDateKey(d);
    const dayClosing = rangeClosings.find((c) => c.date === key && c.locked);
    const dayBankIncome = bankIncome.filter((t) => t.date === key).reduce((sum, t) => sum + t.amount, 0);
    const dayBankExpense = bankExpense.filter((t) => t.date === key).reduce((sum, t) => sum + t.amount, 0);
    const dayNonPlatformRevenue = dayClosing ? nonPlatformRevenue(dayClosing) : 0;
    const revenue = roundCurrency(dayNonPlatformRevenue + platformActualRevenueForDate(key) + dayBankIncome);
    const expense = roundCurrency((dayClosing?.cashExpenseTotal ?? 0) + dayBankExpense);
    trendDays.push({ date: key, revenue, expense, netCashFlow: roundCurrency(revenue - expense) });
  }

  const categoryWiseExpenses = sumByLabel([
    ...monthClosings.flatMap((c) => c.expenses.map((e) => ({ label: e.categoryName, amount: e.amount }))),
    ...monthBankExpense.map((t) => ({ label: t.categoryName ?? "Uncategorized", amount: t.amount })),
  ]);

  const incomeSources = sumByLabel([
    { label: "Cash Revenue", amount: roundCurrency(monthClosings.reduce((sum, c) => sum + c.cashRevenue, 0)) },
    { label: "UPI Sales", amount: roundCurrency(monthClosings.reduce((sum, c) => sum + c.upiSales, 0)) },
    { label: "Zomato Sales", amount: roundCurrency(monthClosings.reduce((sum, c) => sum + zomatoActualRevenueForDate(c.date), 0)) },
    { label: "Swiggy Sales", amount: roundCurrency(monthClosings.reduce((sum, c) => sum + swiggyActualRevenueForDate(c.date), 0)) },
    { label: "Other Income", amount: roundCurrency(monthClosings.reduce((sum, c) => sum + c.otherIncome, 0)) },
    ...monthBankIncome.map((t) => ({ label: t.categoryName ?? "Uncategorized", amount: t.amount })),
  ]);

  return {
    cards: {
      todayCashRevenue,
      todayCashExpense,
      todayPigmiDeposit,
      todayTotalRevenue,
      todayProfit,
      cashOnHand,
      pigmiBalance,
      bankBalance,
      pendingSettlements,
      monthlyRevenue,
      monthlyExpense,
      monthlyProfit,
    },
    revenueExpenseTrend: trendDays,
    categoryWiseExpenses,
    incomeSources,
    topExpenseCategories: categoryWiseExpenses.slice(0, 5),
  };
}

// ─── History range (mobile) ──────────────────────────────────────────────────

export interface FinanceHistoryDay extends FinanceDailyClosing {
  /** Ledger expense transactions for this day (bank payments etc.) — excludes cash-drawer-tagged entries and Daily Closing auto-posts, matching the dashboard's blending rules. */
  bankExpense: number;
  /** cashExpenseTotal + bankExpense — same expense semantics as the web dashboard. */
  totalExpense: number;
}

/**
 * Per-day closings over a range, each augmented with blended expense figures
 * so the mobile History tab can show Revenue vs Expense exactly like the web
 * dashboard: Daily Closing owns cash; non-cash ledger transactions add on top.
 */
export async function getFinanceHistoryRange(
  dateFrom: string,
  dateTo: string,
  db: Firestore = defaultFirestore,
  branchId: string = DEFAULT_BRANCH_ID,
): Promise<FinanceHistoryDay[]> {
  const [closings, accounts, transactions] = await Promise.all([
    getDailyClosingsForRange(dateFrom, dateTo, db, branchId),
    getFinanceAccounts({ branchId }, db),
    getPostedTransactionsForRange(dateFrom, dateTo, db, branchId),
  ]);

  const accountTypeById = new Map(accounts.map((a) => [a.id, a.type]));
  const isCashAccount = (accountId: string | null) => (accountId ? accountTypeById.get(accountId) === "cash" : false);

  const bankExpenseByDate = new Map<string, number>();
  for (const t of transactions) {
    if (t.autoPostedSource === "daily_closing") continue; // Daily Closing generated it itself
    if (t.type !== "expense") continue;
    if (isCashAccount(t.fromAccountId)) continue; // Cash Drawer money belongs to Daily Closing
    bankExpenseByDate.set(t.date, roundCurrency((bankExpenseByDate.get(t.date) ?? 0) + t.amount));
  }

  return closings.map((c) => {
    const bankExpense = bankExpenseByDate.get(c.date) ?? 0;
    return { ...c, bankExpense, totalExpense: roundCurrency(c.cashExpenseTotal + bankExpense) };
  });
}
