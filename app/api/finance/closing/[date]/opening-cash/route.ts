import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { setDailyClosingOpeningCash } from "@/services/financeClosingService";

export const dynamic = "force-dynamic";

/** Only succeeds for the bootstrap case (no previous locked day to chain Opening Cash from). */
export async function PATCH(request: Request, { params }: { params: { date: string } }) {
  try {
    const body = await request.json();
    const { cleanup, firestore } = await getAuthenticatedFirestoreForRequest(request);
    try {
      const closing = await setDailyClosingOpeningCash(params.date, Number(body.openingCash), firestore);
      return NextResponse.json({ success: true, closing });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/closing/[date]/opening-cash PATCH");
  }
}
