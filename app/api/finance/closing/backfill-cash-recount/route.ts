import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { requireAdminCaller } from "@/lib/financeRouteAuth";
import { financeErrorResponse } from "@/lib/financeApiError";
import { backfillCashDrawerRecounts } from "@/services/financeClosingService";

export const dynamic = "force-dynamic";

/**
 * One-time (safely re-runnable) historical fix: walks every already-closed
 * Daily Closing day and posts a "Cash Recount Adjustment" transaction
 * wherever the cash drawer account's ledger balance doesn't match that
 * day's physically-counted Closing Cash — see
 * services/financeClosingService.ts::backfillCashDrawerRecounts. Going
 * forward, closeDailyClosing() does this automatically on every close; this
 * route only exists to bring already-closed history in line the same way.
 * Admin-only, same as the per-account balance reconcile endpoint.
 */
export async function POST(request: Request) {
  try {
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      await requireAdminCaller(firestore, userId);
      const result = await backfillCashDrawerRecounts(userId, userEmail ?? "Unknown", firestore);
      return NextResponse.json({ success: true, result });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/closing/backfill-cash-recount POST");
  }
}
