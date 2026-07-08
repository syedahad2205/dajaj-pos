/**
 * Non-authoritative offline preview (design §9 item 3, Requirement 6.3).
 *
 * ── STRICT CONSTRAINTS (must be satisfied or this file must be deleted) ──
 * 1. MAY sum queued mutations' OWN INPUT AMOUNTS only (e.g. "+₹500 expense pending").
 * 2. SHALL NOT compute cashRevenue, totalRevenue, or any other FinanceDailyClosing
 *    total field — those come exclusively from the server (Requirement 6.1, 6.2).
 * 3. SHALL NOT replicate roundCurrency's rounding semantics, resolveOpeningCash's
 *    chaining logic, or any part of computeDerivedTotals().
 * 4. Output is STRUCTURALLY DISTINCT from FinanceDailyClosing's summary fields
 *    (different field names, clearly non-authoritative shape).
 * 5. NEVER written to useDailyClosing(date)'s TanStack Query cache key.
 * 6. Discarded entirely the instant a fresh server closing arrives.
 *
 * This is a UX affordance only. If the constraints above cannot be satisfied,
 * delete this file and show only the "pending changes, totals will update after sync" message.
 */
import type { QueuedMutation } from '@/core/offline/mutationQueue';

/**
 * The pending totals estimate — deliberately shaped differently from FinanceDailyClosing
 * so it can never be confused with authoritative server data.
 * All fields are labeled "pending" to make the non-authoritative nature explicit.
 */
export interface PendingTotalsEstimate {
  /** Sum of input amounts from queued addExpense mutations — NOT cashExpenseTotal */
  pendingExpenseInputTotal: number;
  /** Sum of input amounts from queued addDeposit mutations — NOT depositTotal */
  pendingDepositInputTotal: number;
  /** Count of queued expense additions */
  pendingExpenseCount: number;
  /** Count of queued deposit additions */
  pendingDepositCount: number;
  /** Count of queued expense removals (amounts unknown without server doc) */
  pendingExpenseRemovalCount: number;
  /** Count of queued deposit removals */
  pendingDepositRemovalCount: number;
  /** Whether closeDailyClosing is queued */
  pendingClose: boolean;
}

const ZERO_ESTIMATE: PendingTotalsEstimate = {
  pendingExpenseInputTotal: 0,
  pendingDepositInputTotal: 0,
  pendingExpenseCount: 0,
  pendingDepositCount: 0,
  pendingExpenseRemovalCount: 0,
  pendingDepositRemovalCount: 0,
  pendingClose: false,
};

/**
 * Sums ONLY the queued mutations' own input amounts for a given date.
 * Returns a clearly non-authoritative estimate — never a finance formula result.
 *
 * @param queuedMutations - The queued mutations for a specific date (from getQueueForDate)
 */
export function estimatePendingTotals(
  queuedMutations: QueuedMutation[],
): PendingTotalsEstimate {
  if (queuedMutations.length === 0) return ZERO_ESTIMATE;

  const result: PendingTotalsEstimate = { ...ZERO_ESTIMATE };

  for (const mutation of queuedMutations) {
    if (mutation.status === 'failed') continue; // Don't show failed mutations as "pending"

    const payload = mutation.payload as Record<string, unknown>;

    switch (mutation.operation) {
      case 'addExpense': {
        // Sum only the raw input amount — no rounding replication (constraint 3)
        const amount = typeof payload.amount === 'number' ? payload.amount : 0;
        result.pendingExpenseInputTotal += amount;
        result.pendingExpenseCount++;
        break;
      }
      case 'removeExpense':
        result.pendingExpenseRemovalCount++;
        break;
      case 'addDeposit': {
        const amount = typeof payload.amount === 'number' ? payload.amount : 0;
        result.pendingDepositInputTotal += amount;
        result.pendingDepositCount++;
        break;
      }
      case 'removeDeposit':
        result.pendingDepositRemovalCount++;
        break;
      case 'closeDailyClosing':
        result.pendingClose = true;
        break;
      // updateSales and setOpeningCash have no simple "input amount" to sum meaningfully;
      // their effect on totals requires the server formula (constraint 2) — omitted.
    }
  }

  return result;
}

/** True if the estimate has any pending changes worth displaying. */
export function hasPendingChanges(estimate: PendingTotalsEstimate): boolean {
  return (
    estimate.pendingExpenseCount > 0 ||
    estimate.pendingDepositCount > 0 ||
    estimate.pendingExpenseRemovalCount > 0 ||
    estimate.pendingDepositRemovalCount > 0 ||
    estimate.pendingClose
  );
}
