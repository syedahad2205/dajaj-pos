import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { closeDailyClosing, getDailyClosingView } from "@/services/financeClosingService";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: { date: string } }) {
  try {
    const { cleanup, firestore } = await getAuthenticatedFirestoreForRequest(request);
    try {
      const closing = await getDailyClosingView(params.date, firestore);
      return NextResponse.json({ success: true, closing });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/closing/[date] GET");
  }
}

/** The single "Save Daily Closing" action: locks the day against the manager's physically-counted Closing Cash. */
export async function POST(request: Request, { params }: { params: { date: string } }) {
  let cleanup: (() => Promise<void>) | undefined;
  try {
    const body = await request.json();
    const authResult = await getAuthenticatedFirestoreForRequest(request);
    cleanup = authResult.cleanup;
    const { firestore, userId, userEmail } = authResult;

    const closing = await closeDailyClosing(params.date, Number(body.closingCash), userId, userEmail ?? "Unknown", firestore);

    void cleanup().catch((err) => console.error("[closing/close] cleanup failed", err));
    return NextResponse.json({ success: true, closing });
  } catch (error) {
    if (cleanup) void cleanup().catch(() => undefined);
    return financeErrorResponse(error, "/closing/[date] POST");
  }
}
