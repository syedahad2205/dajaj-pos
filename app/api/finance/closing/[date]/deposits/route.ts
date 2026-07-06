import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { addDailyClosingDeposit } from "@/services/financeClosingService";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { date: string } }) {
  try {
    const body = await request.json();
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      const closing = await addDailyClosingDeposit(
        params.date,
        { type: body.type, amount: Number(body.amount), remarks: body.remarks },
        userId,
        userEmail ?? "Unknown",
        firestore,
      );
      return NextResponse.json({ success: true, closing });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/closing/[date]/deposits POST");
  }
}
