import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { toDateKey, roundCurrency, DEFAULT_BRANCH_ID, type FinanceDailyClosing } from "@/lib/finance";
import { getDailyClosingsForRange } from "@/services/financeClosingService";
import { getFinanceAccounts } from "@/services/financeAccountsService";
import { getPostedTransactionsForRange } from "@/services/financeTransactionsService";
import { getZomatoImports, getItemSalesForDateRange } from "@/services/zomatoService";
import { getSwiggyImports, getSwiggyItemSalesForDateRange } from "@/services/swiggyService";

// ─── Platform (Zomato/Swiggy) revenue: real for P&L, estimated for display ─────
//
// IMPORTANT — why revenue here must be GROSS, not net of deduction:
// Daily Closing's zomatoSales/swiggySales gets posted every day as Income
// into a Zomato/Swiggy Escrow account (Finance Defaults' zomato_sales/
// swiggy_sales events — see financeClosingService.ts). When a payout is
// settled, services/zomatoFinanceService.ts / swiggyFinanceService.ts sums
// that same Escrow income for the settlement's date range and posts the
// shortfall as a real ledger Expense ("Zomato/Swiggy Settlement
// Deduction") — which already flows into this report's "Expenses by
// Category" (it's a normal, non-daily_closing ledger transaction). So the
// commission is ALREADY subtracted once, as an expense. If revenue here
// were ALSO net of that same deduction, the commission would be
// subtracted twice and understate Net P&L. Two numbers are computed per
// day instead, for two different audiences:
//
//   - actualNet  — feeds Total Revenue / Net P&L / Gross Margin / Revenue
//                  Breakdown. ₹0 until that week's payout is actually
//                  settled, then the GROSS daily figure (matching exactly
//                  what was posted to Escrow that day) — never net. The
//                  Settlement Deduction expense (elsewhere in this same
//                  report) is what brings it down to the real payout:
//                  Revenue (gross) − Deduction (expense) = actual cash
//                  received, with no double-counting either way.
//   - displayNet — feeds the Daily Breakdown table only, as a "day-by-day
//                  feel" preview — always net of the deduction (real once
//                  settled, a best-effort estimate off the most recently
//                  settled week's deduction % until then), so it reads as
//                  roughly "what this day is worth after commission."
//                  Never used in any total.
type PlatformMode = "actual" | "estimated" | "unavailable";

interface PlatformImportLike {
  id: string;
  reportStartDate: string;
  reportEndDate: string;
  deductionPct?: number;
}

interface PlatformItemSaleLike {
  date: string;
  importId: string;
  revenue: number;
}

interface PlatformDayInfo {
  actualNet: number;
  displayNet: number;
  mode: PlatformMode;
  deductionPct: number;
  sourceStart: string | null;
  sourceEnd: string | null;
}

/**
 * Builds a date -> PlatformDayInfo map.
 *   - `actualNet` = the day's manually entered gross (closingGrossByDate)
 *     if that date falls inside a SETTLED import's period, else 0.
 *     Deliberately NOT net of deduction — see the comment above.
 *   - `displayNet` = net of deduction always (real per-day CSV revenue ×
 *     that settlement's real % once settled, else an estimate), purely
 *     for the Daily Breakdown table.
 */
function buildPlatformDayInfo(
  imports: PlatformImportLike[],
  itemSales: PlatformItemSaleLike[],
  closingGrossByDate: Map<string, number>,
): Map<string, PlatformDayInfo> {
  const settledImports = imports.filter((i) => typeof i.deductionPct === "number");
  const settledById = new Map(settledImports.map((i) => [i.id, i]));
  const mostRecentSettled = [...settledImports].sort((a, b) =>
    b.reportEndDate.localeCompare(a.reportEndDate),
  )[0] ?? null;

  // Real per-day CSV gross (any import, settled or not) — used for the
  // display estimate's gross figure when available, in place of the
  // manually entered Daily Closing figure.
  const rawGrossByDate = new Map<string, number>();
  // Real per-day net (settled imports only, from actual item-sales rows) —
  // used for displayNet's "actual" case. Falls back to
  // manualGross × deductionPct if a settled day has no item-sales rows.
  const settledDisplayNetByDate = new Map<string, { net: number; pct: number; start: string; end: string }>();
  for (const row of itemSales) {
    rawGrossByDate.set(row.date, roundCurrency((rawGrossByDate.get(row.date) ?? 0) + row.revenue));
    const imp = settledById.get(row.importId);
    if (!imp) continue;
    const net = roundCurrency(row.revenue * (1 - imp.deductionPct!));
    const existing = settledDisplayNetByDate.get(row.date);
    settledDisplayNetByDate.set(row.date, {
      net: roundCurrency((existing?.net ?? 0) + net),
      pct: imp.deductionPct!,
      start: imp.reportStartDate,
      end: imp.reportEndDate,
    });
  }

  const findCoveringSettledImport = (date: string) =>
    settledImports.find((i) => date >= i.reportStartDate && date <= i.reportEndDate);

  const allDates = new Set<string>([...rawGrossByDate.keys(), ...closingGrossByDate.keys()]);
  const result = new Map<string, PlatformDayInfo>();
  for (const date of allDates) {
    const covering = findCoveringSettledImport(date);
    if (covering) {
      const manualGross = closingGrossByDate.get(date) ?? 0;
      const displayInfo = settledDisplayNetByDate.get(date);
      result.set(date, {
        actualNet: manualGross,
        displayNet: displayInfo ? displayInfo.net : roundCurrency(manualGross * (1 - covering.deductionPct!)),
        mode: "actual",
        deductionPct: covering.deductionPct!,
        sourceStart: covering.reportStartDate,
        sourceEnd: covering.reportEndDate,
      });
      continue;
    }

    const gross = rawGrossByDate.get(date) ?? closingGrossByDate.get(date) ?? 0;
    if (mostRecentSettled) {
      result.set(date, {
        actualNet: 0,
        displayNet: roundCurrency(gross * (1 - mostRecentSettled.deductionPct!)),
        mode: "estimated",
        deductionPct: mostRecentSettled.deductionPct!,
        sourceStart: mostRecentSettled.reportStartDate,
        sourceEnd: mostRecentSettled.reportEndDate,
      });
    } else {
      result.set(date, { actualNet: 0, displayNet: gross, mode: "unavailable", deductionPct: 0, sourceStart: null, sourceEnd: null });
    }
  }
  return result;
}

function lookupPlatformDayInfo(byDate: Map<string, PlatformDayInfo>, date: string): PlatformDayInfo {
  return byDate.get(date) ?? { actualNet: 0, displayNet: 0, mode: "unavailable", deductionPct: 0, sourceStart: null, sourceEnd: null };
}

export const dynamic = "force-dynamic";

// ─── Shared aggregation helper (same pattern as financeDashboardService) ──────

function sumByLabel(items: Array<{ label: string; amount: number }>): Array<{ label: string; amount: number }> {
  const totals = new Map<string, number>();
  for (const item of items) {
    totals.set(item.label, roundCurrency((totals.get(item.label) ?? 0) + item.amount));
  }
  return Array.from(totals.entries())
    .map(([label, amount]) => ({ label, amount }))
    .filter((item) => item.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

// ─── GET /api/finance/reports/pnl ─────────────────────────────────────────────

/**
 * Comprehensive P&L report for a date range.
 *
 * Mirrors the data-blending logic in financeDashboardService:
 *   - Daily Closing (fin_daily_closing): all revenue streams + cash expenses.
 *   - Transactions (fin_transactions): posted income/expense from non-cash
 *     accounts that were NOT auto-generated by Daily Closing itself (those
 *     are already counted in the closing totals — excluding them prevents
 *     double-counting). Transfers are excluded from P&L as always.
 *
 * The two sources are intentionally NOT mixed at the row level — the caller
 * sees closing rows for the day-by-day table and a pre-aggregated summary
 * (with category breakdowns) for the totals sections. The frontend never
 * has to know about account types or auto-post sources.
 */
export async function GET(request: Request) {
  try {
    const { cleanup, firestore } = await getAuthenticatedFirestoreForRequest(request);
    try {
      const url = new URL(request.url);
      const today = toDateKey();
      const dateFrom = url.searchParams.get("dateFrom") ?? today;
      const dateTo = url.searchParams.get("dateTo") ?? today;
      const branchId = DEFAULT_BRANCH_ID;

      // Fetch all sources in parallel
      const [rawClosings, accounts, rangeTransactions, zomatoImports, swiggyImports, zomatoItemSales, swiggyItemSales] = await Promise.all([
        getDailyClosingsForRange(dateFrom, dateTo, firestore, branchId),
        getFinanceAccounts({ branchId }, firestore),
        getPostedTransactionsForRange(dateFrom, dateTo, firestore, branchId),
        getZomatoImports(firestore),
        getSwiggyImports(firestore),
        getItemSalesForDateRange(dateFrom, dateTo, firestore),
        getSwiggyItemSalesForDateRange(dateFrom, dateTo, firestore),
      ]);

      const zomatoClosingGrossByDate = new Map(rawClosings.map((c) => [c.date, c.zomatoSales]));
      const swiggyClosingGrossByDate = new Map(rawClosings.map((c) => [c.date, c.swiggySales]));
      const zomatoByDate = buildPlatformDayInfo(zomatoImports, zomatoItemSales, zomatoClosingGrossByDate);
      const swiggyByDate = buildPlatformDayInfo(swiggyImports, swiggyItemSales, swiggyClosingGrossByDate);

      const closingsWithSettled = rawClosings.map((c) => {
        const zomato = lookupPlatformDayInfo(zomatoByDate, c.date);
        const swiggy = lookupPlatformDayInfo(swiggyByDate, c.date);
        return {
          ...c,
          // actualNet feeds P&L/KPI totals below — GROSS, settled-only (see
          // the big comment above buildPlatformDayInfo for why this must
          // not be net of deduction).
          zomatoActualRevenue: zomato.actualNet,
          swiggyActualRevenue: swiggy.actualNet,
          // displayNet feeds the Daily Breakdown table only — actual once
          // settled, a best-effort estimate until then.
          zomatoDisplayRevenue: zomato.displayNet,
          zomatoDeductionPct: zomato.deductionPct,
          zomatoMode: zomato.mode,
          zomatoSourceStart: zomato.sourceStart,
          zomatoSourceEnd: zomato.sourceEnd,
          swiggyDisplayRevenue: swiggy.displayNet,
          swiggyDeductionPct: swiggy.deductionPct,
          swiggyMode: swiggy.mode,
          swiggySourceStart: swiggy.sourceStart,
          swiggySourceEnd: swiggy.sourceEnd,
        };
      });

      const accountTypeById = new Map(accounts.map((a) => [a.id, a.type]));
      const isCashAccount = (accountId: string | null) =>
        accountId ? accountTypeById.get(accountId) === "cash" : false;

      // Exclude daily_closing auto-posts (already counted in closing totals)
      // and transfers (not P&L items)
      const relevantTx = rangeTransactions.filter(
        (t) => t.autoPostedSource !== "daily_closing" && t.type !== "transfer",
      );
      const ledgerIncomeTx = relevantTx.filter(
        (t) => t.type === "income" && !isCashAccount(t.toAccountId),
      );
      const ledgerExpenseTx = relevantTx.filter(
        (t) => t.type === "expense" && !isCashAccount(t.fromAccountId),
      );

      // ── Locked closings only for P&L totals ──
      const lockedClosings: FinanceDailyClosing[] = rawClosings.filter((c) => c.locked);
      const lockedClosingsWithSettled = closingsWithSettled.filter((c) => c.locked);

      const closingCashRevenue = roundCurrency(lockedClosings.reduce((s, c) => s + c.cashRevenue, 0));
      const closingUpi = roundCurrency(lockedClosings.reduce((s, c) => s + c.upiSales, 0));
      const closingOther = roundCurrency(lockedClosings.reduce((s, c) => s + c.otherIncome, 0));
      const closingCashExpense = roundCurrency(lockedClosings.reduce((s, c) => s + c.cashExpenseTotal, 0));
      const closingDeposits = roundCurrency(lockedClosings.reduce((s, c) => s + c.depositTotal, 0));

      // Gross Zomato/Swiggy revenue, counted only for days whose platform
      // payout has actually been settled (₹0 otherwise) — see
      // buildPlatformDayInfo above. Left as gross (not net of deduction) on
      // purpose: the commission already lands as a separate "Settlement
      // Deduction" expense below, via ledgerExpenseTx.
      const settledZomato = roundCurrency(lockedClosingsWithSettled.reduce((s, c) => s + c.zomatoActualRevenue, 0));
      const settledSwiggy = roundCurrency(lockedClosingsWithSettled.reduce((s, c) => s + c.swiggyActualRevenue, 0));

      const closingRevenue = roundCurrency(closingCashRevenue + closingUpi + closingOther + settledZomato + settledSwiggy);

      const ledgerIncome = roundCurrency(ledgerIncomeTx.reduce((s, t) => s + t.amount, 0));
      const ledgerExpense = roundCurrency(ledgerExpenseTx.reduce((s, t) => s + t.amount, 0));

      const totalRevenue = roundCurrency(closingRevenue + ledgerIncome);
      const totalExpense = roundCurrency(closingCashExpense + ledgerExpense);
      const netPnl = roundCurrency(totalRevenue - totalExpense);

      // ── Revenue breakdown ──
      const revenueBreakdown = {
        cashSales: closingCashRevenue,
        upi: closingUpi,
        zomato: settledZomato,
        swiggy: settledSwiggy,
        otherIncome: closingOther,
        ledgerIncome,
      };

      // ── Expense by category (closing cash expenses + ledger expenses) ──
      const closingExpenseItems = lockedClosings.flatMap((c) =>
        c.expenses.map((e) => ({
          label: e.subcategoryName ? `${e.categoryName} › ${e.subcategoryName}` : e.categoryName,
          amount: e.amount,
        })),
      );
      const ledgerExpenseItems = ledgerExpenseTx.map((t) => ({
        label: t.categoryName ?? "Uncategorized",
        amount: t.amount,
      }));
      const expenseByCategory = sumByLabel([...closingExpenseItems, ...ledgerExpenseItems]);

      // ── Income by category (ledger income only — closing already broken down separately) ──
      const ledgerIncomeByCategory = sumByLabel(
        ledgerIncomeTx.map((t) => ({
          label: t.categoryName ?? "Uncategorized",
          amount: t.amount,
        })),
      );

      // ── Deposit breakdown ──
      const depositMap = new Map<string, { label: string; amount: number }>();
      for (const closing of lockedClosings) {
        for (const d of closing.deposits) {
          const existing = depositMap.get(d.type) ?? { label: d.typeLabel, amount: 0 };
          depositMap.set(d.type, { label: d.typeLabel, amount: roundCurrency(existing.amount + d.amount) });
        }
      }
      const depositBreakdown = Array.from(depositMap.values()).sort((a, b) => b.amount - a.amount);

      return NextResponse.json({
        success: true,
        closings: closingsWithSettled, // full rows for day-by-day table (includes drafts), with real settled Zomato/Swiggy revenue attached
        summary: {
          closedDays: lockedClosings.length,
          draftDays: rawClosings.length - lockedClosings.length,
          totalRevenue,
          totalExpense,
          netPnl,
          revenueBreakdown,
          expenseByCategory,
          ledgerIncomeByCategory,
          depositBreakdown,
          closingDeposits,
        },
        accounts: accounts.map((a) => ({ id: a.id, name: a.name, type: a.type, currentBalance: a.currentBalance })),
      });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/reports/pnl GET");
  }
}
