import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { reopenDailyClosing } from "@/services/financeClosingService";

export const dynamic = "force-dynamic";

// Admin or Finance Manager — reopening a locked day is now part of Finance
// Manager's full Daily Closing access. Every reopen is written to
// fin_audit_logs (module "closing", action "reopen") with the reason,
// who did it, and the before/after state — visible to Admin on the
// Finance Audit Log page.
export async function POST(request: Request, { params }: { params: { date: string } }) {
  try {
    const body = await request.json();
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      await reopenDailyClosing(params.date, userId, userEmail ?? "Unknown", body.reason ?? "", firestore);
      return NextResponse.json({ success: true });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/closing/[date]/reopen POST");
  }
}
