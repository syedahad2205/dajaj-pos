/**
 * Zomato ↔ Finance bridge.
 *
 * Daily Closing recognizes Zomato revenue every day into a Zomato Escrow
 * account (via Finance Defaults' "zomato_sales" event) — that's money
 * earned, not money received. This file reconciles the real thing: when a
 * settlement is saved in the Zomato module (services/zomatoService.ts),
 * it sums however much Escrow revenue was recognized for the payout's
 * covered dates, diffs that against the actual Final Payout, and posts
 * the real cash movement — a Transfer out of Escrow for the payout amount,
 * plus an Expense/Income for whatever Zomato's cut differed from what was
 * recognized.
 */
import { collection, doc, getDoc, serverTimestamp, updateDoc, type Firestore } from "firebase/firestore";
import { auth, firestore as defaultFirestore } from "@/lib/firebase";
import { DEFAULT_BRANCH_ID, roundCurrency } from "@/lib/finance";
import { getFinanceDefaultsMap } from "@/services/financeDefaultsService";
import { createFinanceTransaction, getPostedTransactionsForRange, voidFinanceTransaction } from "@/services/financeTransactionsService";
import { getOrCreateExpenseCategoryIdByName, getOrCreateIncomeCategoryIdByName } from "@/services/financeCategoriesService";

const ZOMATO_SALES_EVENT_KEY = "zomato_sales";
const ZOMATO_SETTLEMENT_RECEIVED_EVENT_KEY = "zomato_settlement_received";

function importsCollection(db: Firestore) {
  return collection(db, "zomato_imports");
}

export interface ZomatoSettlementFinancePosting {
  escrowTotal: number;
  finalPayout: number;
  /** escrowTotal - finalPayout. >0 posts as an Expense (Zomato kept more than recognized); <0 posts as Income (Zomato paid more than recognized); 0 posts nothing. */
  difference: number;
  transferTransactionId: string | null;
  adjustmentTransactionId: string | null;
  warnings: string[];
}

/**
 * Reconciles one Zomato payout against Escrow and posts the real cash
 * movement to Finance. Idempotent and safe to re-run (e.g. after fixing a
 * Finance Defaults mapping, or after editing the settlement's numbers) —
 * voids whatever it posted last time before posting fresh. Never throws
 * for a missing/inactive Finance Defaults mapping; records a warning on
 * the import doc instead so the core settlement save is never blocked by
 * a Finance configuration gap.
 */
export async function postZomatoSettlementToFinance(
  importId: string,
  db: Firestore = defaultFirestore,
  branchId: string = DEFAULT_BRANCH_ID,
): Promise<ZomatoSettlementFinancePosting> {
  const userId = auth.currentUser?.uid ?? "unknown";
  const userName = auth.currentUser?.email ?? "Unknown";

  const importRef = doc(importsCollection(db), importId);
  const importSnap = await getDoc(importRef);
  if (!importSnap.exists()) throw new Error("Zomato import not found.");
  const importData = importSnap.data() as {
    reportStartDate: string;
    reportEndDate: string;
    finalPayout?: number;
    netOrderValue?: number;
    financeTransferTransactionId?: string | null;
    financeAdjustmentTransactionId?: string | null;
  };

  if (typeof importData.finalPayout !== "number" || typeof importData.netOrderValue !== "number") {
    throw new Error("Save the settlement (Net Order Value + Final Payout) before posting it to Finance.");
  }
  const finalPayout = importData.finalPayout;
  const warnings: string[] = [];

  // Re-save / edited settlement: void whatever posted last time before posting fresh numbers.
  for (const txId of [importData.financeTransferTransactionId, importData.financeAdjustmentTransactionId]) {
    if (!txId) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      await voidFinanceTransaction(txId, userId, userName, `Zomato settlement for ${importId} was re-saved`, db);
    } catch (err) {
      warnings.push(`Could not clean up a previous posting: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  const defaultsMap = await getFinanceDefaultsMap(db, branchId);
  const escrowMapping = defaultsMap.get(ZOMATO_SALES_EVENT_KEY);

  if (!escrowMapping?.destinationAccountId) {
    warnings.push(
      `"Zomato Sales" has no destination account configured in Settings > Finance Defaults — can't tell how much Escrow this settlement should clear.`,
    );
    await updateDoc(importRef, {
      financeTransferTransactionId: null,
      financeAdjustmentTransactionId: null,
      financeEscrowTotal: null,
      financeDifference: null,
      financePostingWarnings: warnings,
      updatedAt: serverTimestamp(),
    });
    return { escrowTotal: 0, finalPayout, difference: 0, transferTransactionId: null, adjustmentTransactionId: null, warnings };
  }
  const escrowAccountId = escrowMapping.destinationAccountId;

  const rangeTransactions = await getPostedTransactionsForRange(importData.reportStartDate, importData.reportEndDate, db, branchId);
  const escrowTotal = roundCurrency(
    rangeTransactions.filter((t) => t.type === "income" && t.toAccountId === escrowAccountId).reduce((sum, t) => sum + t.amount, 0),
  );
  const difference = roundCurrency(escrowTotal - finalPayout);

  const receivedMapping = defaultsMap.get(ZOMATO_SETTLEMENT_RECEIVED_EVENT_KEY);
  let transferTransactionId: string | null = null;
  let adjustmentTransactionId: string | null = null;
  // Booked on reportEndDate (the settlement period's last day), NOT the day
  // the settlement happens to be saved. Zomato pays out roughly a week
  // later — if it's booked on "today" instead, a payout recorded the
  // following week can land in the NEXT calendar month while the revenue
  // it nets against (recognized per the actual sale days, reportStartDate
  // through reportEndDate) stays in the earlier month, throwing off both
  // months' P&L. Booking it on reportEndDate guarantees it always falls
  // inside the exact same date range as the revenue it's settling.
  const postingDate = importData.reportEndDate;
  const period = `${importData.reportStartDate} to ${importData.reportEndDate}`;

  if (!receivedMapping?.destinationAccountId) {
    warnings.push(`"Zomato Settlement Received" has no destination account configured in Settings > Finance Defaults — the payout wasn't transferred out of Escrow.`);
  } else if (finalPayout > 0) {
    try {
      const tx = await createFinanceTransaction(
        {
          type: "transfer",
          date: postingDate,
          amount: finalPayout,
          fromAccountId: escrowAccountId,
          toAccountId: receivedMapping.destinationAccountId,
          remarks: `Zomato Settlement for ${period}`,
          branchId,
          autoPosted: true,
          autoPostedSource: "zomato_settlement",
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
      const categoryId = await getOrCreateExpenseCategoryIdByName("Zomato Settlement Deduction", userId, userName, db, branchId);
      const tx = await createFinanceTransaction(
        {
          type: "expense",
          date: postingDate,
          categoryId,
          amount: difference,
          fromAccountId: escrowAccountId,
          remarks: `Zomato Settlement deduction for ${period}`,
          branchId,
          autoPosted: true,
          autoPostedSource: "zomato_settlement",
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
      const categoryId = await getOrCreateIncomeCategoryIdByName("Zomato Settlement Adjustment", userId, userName, db, branchId);
      const tx = await createFinanceTransaction(
        {
          type: "income",
          date: postingDate,
          categoryId,
          amount: Math.abs(difference),
          toAccountId: escrowAccountId,
          remarks: `Zomato Settlement adjustment for ${period}`,
          branchId,
          autoPosted: true,
          autoPostedSource: "zomato_settlement",
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

  return { escrowTotal, finalPayout, difference, transferTransactionId, adjustmentTransactionId, warnings };
}
