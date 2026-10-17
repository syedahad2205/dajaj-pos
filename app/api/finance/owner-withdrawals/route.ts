import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { requireAdminCaller } from "@/lib/financeRouteAuth";
import { financeErrorResponse } from "@/lib/financeApiError";
import { DEFAULT_BRANCH_ID, isValidDateKey, toDateKey } from "@/lib/finance";
import { createFinanceTransaction, getOwnerWithdrawals } from "@/services/financeTransactionsService";
import { getFinanceDefaultsMap } from "@/services/financeDefaultsService";
import { isDayLocked } from "@/services/financeClosingService";

export const dynamic = "force-dynamic";

/** GET — every Owner Withdrawal (posted + void), newest first. Admin-only. */
export async function GET(request: Request) {
  try {
    const { cleanup, firestore, userId } = await getAuthenticatedFirestoreForRequest(request);
    try {
      await requireAdminCaller(firestore, userId);
      const withdrawals = await getOwnerWithdrawals(firestore);
      return NextResponse.json({ success: true, withdrawals });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/owner-withdrawals GET");
  }
}

/**
 * POST { date, amount, fromAccountId, partnerPct, remarks }
 * Takes profit out of one account, split between the owner and the partner.
 * Admin-only. Recorded as an owner_withdrawal ledger row — reduces the
 * account balance, never counted as an expense.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      await requireAdminCaller(firestore, userId);

      const today = toDateKey();
      const date = typeof body.date === "string" && isValidDateKey(body.date) ? body.date : today;
      if (date > today) throw new Error("An Owner Withdrawal can't be dated in the future.");

      // Cash taken from the till is folded into that day's Opening Cash at
      // close (see netCashDrawerTransferAdjustment). A day that's already
      // closed has its numbers frozen, so it can't absorb it.
      const cashDrawerAccountId = (await getFinanceDefaultsMap(firestore, DEFAULT_BRANCH_ID)).get("cash_sales")?.destinationAccountId ?? null;
      if (cashDrawerAccountId && body.fromAccountId === cashDrawerAccountId && (await isDayLocked(date, firestore))) {
        throw new Error(`Daily Closing for ${date} is already closed. Take cash from the drawer on a day that's still open, or pick another account.`);
      }

      const created = await createFinanceTransaction(
        {
          type: "owner_withdrawal",
          date,
          amount: Number(body.amount),
          fromAccountId: typeof body.fromAccountId === "string" ? body.fromAccountId : null,
          partnerPct: Number(body.partnerPct),
          description: "Owner Withdrawal",
          remarks: typeof body.remarks === "string" ? body.remarks.slice(0, 500) : "",
        },
        userId,
        userEmail ?? "Unknown",
        firestore,
      );
      return NextResponse.json({ success: true, withdrawal: created });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/owner-withdrawals POST");
  }
}
