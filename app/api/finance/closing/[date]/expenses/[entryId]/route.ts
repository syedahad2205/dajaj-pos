import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { removeDailyClosingExpense } from "@/services/financeClosingService";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request, { params }: { params: { date: string; entryId: string } }) {
  try {
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      const closing = await removeDailyClosingExpense(params.date, params.entryId, userId, userEmail ?? "Unknown", firestore);
      return NextResponse.json({ success: true, closing });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/closing/[date]/expenses/[entryId] DELETE");
  }
}
