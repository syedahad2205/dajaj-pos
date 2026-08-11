import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { requireAdminCaller } from "@/lib/financeRouteAuth";
import { financeErrorResponse } from "@/lib/financeApiError";
import { reopenDailyClosing } from "@/services/financeClosingService";

export const dynamic = "force-dynamic";

// Admin-only, even for a Finance Manager who otherwise has write access to
// fin_daily_closing — reopening a locked day is a correction action.
export async function POST(request: Request, { params }: { params: { date: string } }) {
  try {
    const body = await request.json();
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      await requireAdminCaller(firestore, userId);
      await reopenDailyClosing(params.date, userId, userEmail ?? "Unknown", body.reason ?? "", firestore);
      return NextResponse.json({ success: true });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/closing/[date]/reopen POST");
  }
}
