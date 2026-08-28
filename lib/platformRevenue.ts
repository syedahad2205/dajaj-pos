import { roundCurrency } from "@/lib/finance";

// ─── Platform (Zomato/Swiggy) revenue: real once settled, estimated for display ─
//
// Shared by app/api/finance/reports/pnl/route.ts and
// services/financeDashboardService.ts — both need the exact same
// settlement-gated revenue number, so this lives in one place instead of
// being reimplemented twice (which is how the two pages drifted out of
// sync before).
//
// IMPORTANT — why revenue here must be GROSS, not net of deduction:
// Daily Closing's zomatoSales/swiggySales gets posted every day as Income
// into a Zomato/Swiggy Escrow account (Finance Defaults' zomato_sales/
// swiggy_sales events — see financeClosingService.ts). When a payout is
// settled, services/zomatoFinanceService.ts / swiggyFinanceService.ts sums
// that same Escrow income for the settlement's date range and posts the
// shortfall as a real ledger Expense ("Zomato/Swiggy Settlement
// Deduction") — which flows into "Expenses by Category" on both pages (it's
// a normal, non-daily_closing ledger transaction). So the commission is
// ALREADY subtracted once, as an expense. If revenue here were ALSO net of
// that same deduction, the commission would be subtracted twice and
// understate profit. Two numbers are computed per day instead, for two
// different audiences:
//
//   - actualNet  — feeds Total/Monthly Revenue, Net P&L / Monthly Profit,
//                  Gross Margin, Revenue Breakdown. ₹0 until that week's
//                  payout is actually settled, then the GROSS daily figure
//                  (matching exactly what was posted to Escrow that day) —
//                  never net. The Settlement Deduction expense (posted
//                  separately) is what brings it down to the real payout:
//                  Revenue (gross) − Deduction (expense) = actual cash
//                  received, with no double-counting either way.
//   - displayNet — feeds the Daily Breakdown table only, as a "day-by-day
//                  feel" preview — always net of the deduction (real once
//                  settled, a best-effort estimate off the most recently
//                  settled week's deduction % until then), so it reads as
//                  roughly "what this day is worth after commission."
//                  Never used in any total.
export type PlatformMode = "actual" | "estimated" | "unavailable";

export interface PlatformImportLike {
  id: string;
  reportStartDate: string;
  reportEndDate: string;
  deductionPct?: number;
}

export interface PlatformItemSaleLike {
  date: string;
  importId: string;
  revenue: number;
}

export interface PlatformDayInfo {
  actualNet: number;
  displayNet: number;
  mode: PlatformMode;
  deductionPct: number;
  sourceStart: string | null;
  sourceEnd: string | null;
}

const UNAVAILABLE_DAY_INFO: PlatformDayInfo = {
  actualNet: 0,
  displayNet: 0,
  mode: "unavailable",
  deductionPct: 0,
  sourceStart: null,
  sourceEnd: null,
};

/**
 * Builds a date -> PlatformDayInfo map.
 *   - `actualNet` = the day's manually entered gross (closingGrossByDate)
 *     if that date falls inside a SETTLED import's period, else 0.
 *     Deliberately NOT net of deduction — see the comment above.
 *   - `displayNet` = net of deduction always (real per-day CSV revenue ×
 *     that settlement's real % once settled, else an estimate), purely
 *     for a "day-by-day feel" display — never for totals.
 */
export function buildPlatformDayInfo(
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
      result.set(date, { ...UNAVAILABLE_DAY_INFO, displayNet: gross });
    }
  }
  return result;
}

export function lookupPlatformDayInfo(byDate: Map<string, PlatformDayInfo>, date: string): PlatformDayInfo {
  return byDate.get(date) ?? UNAVAILABLE_DAY_INFO;
}
