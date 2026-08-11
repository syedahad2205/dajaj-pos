import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { requireAdminCaller } from "@/lib/financeRouteAuth";
import { financeErrorResponse } from "@/lib/financeApiError";
import { backfillDailyClosingPostings } from "@/services/financeClosingService";

export const dynamic = "force-dynamic";

/**
 * Retries only the events that failed to auto-post when this (already closed) day was saved — e.g. after fixing a Finance Defaults mapping.
 * Admin-only, even for a Finance Manager who otherwise has write access to fin_daily_closing.
 */
export async function POST(request: Request, { params }: { params: { date: string } }) {
  try {
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      await requireAdminCaller(firestore, userId);
      const { closing, postedEventKeys } = await backfillDailyClosingPostings(params.date, userId, userEmail ?? "Unknown", firestore);
      return NextResponse.json({ success: true, closing, postedEventKeys });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/closing/[date]/backfill POST");
  }
}
