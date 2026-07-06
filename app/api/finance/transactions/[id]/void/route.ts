import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { voidFinanceTransaction } from "@/services/financeTransactionsService";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json().catch(() => ({}));
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      await voidFinanceTransaction(params.id, userId, userEmail ?? "Unknown", body.reason ?? "", firestore);
      return NextResponse.json({ success: true });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/transactions/[id]/void POST");
  }
}
