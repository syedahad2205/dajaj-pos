/**
 * Swiggy ↔ Finance bridge.
 *
 * Mirrors services/zomatoFinanceService.ts exactly — same reconciliation
 * model, just pointed at Swiggy's own Finance Defaults events and
 * collections:
 *
 * Daily Closing recognizes Swiggy revenue every day into a Swiggy Escrow
 * account (via Finance Defaults' "swiggy_sales" event) — that's money
 * earned, not money received. This file reconciles the real thing: when a
 * settlement is saved in the Swiggy module (services/swiggyService.ts), it
 * sums however much Escrow revenue was recognized for the payout's covered
 * dates, diffs that against the actual Net Payout, and posts the real cash
 * movement — a Transfer out of Escrow into wherever Swiggy settlements
 * actually land (mapped via "swiggy_settlement_received", e.g. IDBI), plus
 * an Expense/Income for whatever Swiggy's cut differed from what was
 * recognized.
 */
import { collection, doc, getDoc, serverTimestamp, updateDoc, type Firestore } from "firebase/firestore";
import { auth, firestore as defaultFirestore } from "@/lib/firebase";
import { DEFAULT_BRANCH_ID, roundCurrency, toDateKey } from "@/lib/finance";
import { getFinanceDefaultsMap } from "@/services/financeDefaultsService";
import { createFinanceTransaction, getPostedTransactionsForRange, voidFinanceTransaction } from "@/services/financeTransactionsService";
import { getOrCreateExpenseCategoryIdByName, getOrCreateIncomeCategoryIdByName } from "@/services/financeCategoriesService";

const SWIGGY_SALES_EVENT_KEY = "swiggy_sales";
const SWIGGY_SETTLEMENT_RECEIVED_EVENT_KEY = "swiggy_settlement_received";

function importsCollection(db: Firestore) {
  return collection(db, "swiggy_imports");
}

export interface SwiggySettlementFinancePosting {
  escrowTotal: number;
  netPayout: number;
  /** escrowTotal - netPayout. >0 posts as an Expense (Swiggy kept more than recognized); <0 posts as Income (Swiggy paid more than recognized); 0 posts nothing. */
  difference: number;
  transferTransactionId: string | null;
  adjustmentTransactionId: string | null;
  warnings: string[];
}

/**
 * Reconciles one Swiggy payout against Escrow and posts the real cash
 * movement to Finance. Idempotent and safe to re-run (e.g. after fixing a
 * Finance Defaults mapping, or after editing the settlement's numbers) —
 * voids whatever it posted last time before posting fresh. Never throws
 * for a missing/inactive Finance Defaults mapping; records a warning on the
 * import doc instead so the core settlement save is never blocked by a
 * Finance configuration gap.
 */
export async function postSwiggySettlementToFinance(
  importId: string,
  db: Firestore = defaultFirestore,
  branchId: string = DEFAULT_BRANCH_ID,
): Promise<SwiggySettlementFinancePosting> {
  const userId = auth.currentUser?.uid ?? "unknown";
  const userName = auth.currentUser?.email ?? "Unknown";

  const importRef = doc(importsCollection(db), importId);
  const importSnap = await getDoc(importRef);
  if (!importSnap.exists()) throw new Error("Swiggy import not found.");
  const importData = importSnap.data() as {
    reportStartDate: string;
    reportEndDate: string;
    netPayout?: number;
    totalCustomerPaid?: number;
    financeTransferTransactionId?: string | null;
    financeAdjustmentTransactionId?: string | null;
  };

  if (typeof importData.netPayout !== "number" || typeof importData.totalCustomerPaid !== "number") {
    throw new Error("Save the settlement (Total Customer Paid + Net Payout) before posting it to Finance.");
  }
  const netPayout = importData.netPayout;
  const warnings: string[] = [];

  // Re-save / edited settlement: void whatever posted last time before posting fresh numbers.
  for (const txId of [importData.financeTransferTransactionId, importData.financeAdjustmentTransactionId]) {
    if (!txId) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      await voidFinanceTransaction(txId, userId, userName, `Swiggy settlement for ${importId} was re-saved`, db);
    } catch (err) {
      warnings.push(`Could not clean up a previous posting: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  const defaultsMap = await getFinanceDefaultsMap(db, branchId);
  const escrowMapping = defaultsMap.get(SWIGGY_SALES_EVENT_KEY);

  if (!escrowMapping?.destinationAccountId) {
    warnings.push(
      `"Swiggy Sales" has no destination account configured in Settings > Finance Defaults — can't tell how much Escrow this settlement should clear.`,
    );
    await updateDoc(importRef, {
      financeTransferTransactionId: null,
      financeAdjustmentTransactionId: null,
      financeEscrowTotal: null,
      financeDifference: null,
      financePostingWarnings: warnings,
      updatedAt: serverTimestamp(),
    });
    return { escrowTotal: 0, netPayout, difference: 0, transferTransactionId: null, adjustmentTransactionId: null, warnings };
  }
  const escrowAccountId = escrowMapping.destinationAccountId;

  const rangeTransactions = await getPostedTransactionsForRange(importData.reportStartDate, importData.reportEndDate, db, branchId);
  const escrowTotal = roundCurrency(
    rangeTransactions.filter((t) => t.type === "income" && t.toAccountId === escrowAccountId).reduce((sum, t) => sum + t.amount, 0),
  );
  const difference = roundCurrency(escrowTotal - netPayout);

  const receivedMapping = defaultsMap.get(SWIGGY_SETTLEMENT_RECEIVED_EVENT_KEY);
  let transferTransactionId: string | null = null;
  let adjustmentTransactionId: string | null = null;
  const today = toDateKey();
  const period = `${importData.reportStartDate} to ${importData.reportEndDate}`;

  if (!receivedMapping?.destinationAccountId) {
    warnings.push(`"Swiggy Settlement Received" has no destination account configured in Settings > Finance Defaults — the payout wasn't transferred out of Escrow.`);
  } else if (netPayout > 0) {
    try {
      const tx = await createFinanceTransaction(
        {
          type: "transfer",
          date: today,
          amount: netPayout,
          fromAccountId: escrowAccountId,
          toAccountId: receivedMapping.destinationAccountId,
          remarks: `Swiggy Settlement for ${period}`,
          branchId,
          autoPosted: true,
          autoPostedSource: "swiggy_settlement",
        },
        userId,
        userName,
        db,
      );
      transferTransactionId = tx.id;
    } catch (err) {
      warnings.push(`Failed to post the settlement transfer: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  if (difference > 0) {
    try {
      const categoryId = await getOrCreateExpenseCategoryIdByName("Swiggy Settlement Deduction", userId, userName, db, branchId);
      const tx = await createFinanceTransaction(
        {
          type: "expense",
          date: today,
          categoryId,
          amount: difference,
          fromAccountId: escrowAccountId,
          remarks: `Swiggy Settlement deduction for ${period}`,
          branchId,
          autoPosted: true,
          autoPostedSource: "swiggy_settlement",
        },
        userId,
        userName,
        db,
      );
      adjustmentTransactionId = tx.id;
    } catch (err) {
      warnings.push(`Failed to post the settlement deduction: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  } else if (difference < 0) {
    try {
      const categoryId = await getOrCreateIncomeCategoryIdByName("Swiggy Settlement Adjustment", userId, userName, db, branchId);
      const tx = await createFinanceTransaction(
        {
          type: "income",
          date: today,
          categoryId,
          amount: Math.abs(difference),
          toAccountId: escrowAccountId,
          remarks: `Swiggy Settlement adjustment for ${period}`,
          branchId,
          autoPosted: true,
          autoPostedSource: "swiggy_settlement",
        },
        userId,
        userName,
        db,
      );
      adjustmentTransactionId = tx.id;
    } catch (err) {
      warnings.push(`Failed to post the settlement adjustment: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  await updateDoc(importRef, {
    financeTransferTransactionId: transferTransactionId,
    financeAdjustmentTransactionId: adjustmentTransactionId,
    financeEscrowTotal: escrowTotal,
    financeDifference: difference,
    financePostingWarnings: warnings,
    updatedAt: serverTimestamp(),
  });

  return { escrowTotal, netPayout, difference, transferTransactionId, adjustmentTransactionId, warnings };
}
