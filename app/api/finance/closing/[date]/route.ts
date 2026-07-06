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
  try {
    const body = await request.json();
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      const closing = await closeDailyClosing(params.date, Number(body.closingCash), userId, userEmail ?? "Unknown", firestore);
      return NextResponse.json({ success: true, closing });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/closing/[date] POST");
  }
}
