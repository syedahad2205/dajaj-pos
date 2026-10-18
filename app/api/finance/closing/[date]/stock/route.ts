import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { getDailyClosingStockView, updateDailyClosingStock } from "@/services/financeClosingService";

export const dynamic = "force-dynamic";

/** GET — the day's stock rows, shawarma counts, prices, expected openings and estimated sales. */
export async function GET(request: Request, { params }: { params: { date: string } }) {
  try {
    const { cleanup, firestore } = await getAuthenticatedFirestoreForRequest(request);
    try {
      const view = await getDailyClosingStockView(params.date, firestore);
      return NextResponse.json({ success: true, view });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/closing/[date]/stock GET");
  }
}

/** PATCH { rows: [{ itemId, opening, closing, order, mismatchReason }], shawarmaSold: { khubbusRoll, … } } */
export async function PATCH(request: Request, { params }: { params: { date: string } }) {
  try {
    const body = await request.json().catch(() => ({}));
    const { cleanup, firestore } = await getAuthenticatedFirestoreForRequest(request);
    try {
      await updateDailyClosingStock(params.date, { rows: body.rows ?? [], shawarmaSold: body.shawarmaSold }, firestore);
      const view = await getDailyClosingStockView(params.date, firestore);
      return NextResponse.json({ success: true, view });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/closing/[date]/stock PATCH");
  }
}
