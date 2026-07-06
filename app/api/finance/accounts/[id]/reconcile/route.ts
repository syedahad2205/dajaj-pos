import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { reconcileAccountBalance } from "@/services/financeTransactionsService";

export const dynamic = "force-dynamic";

/** Compares stored currentBalance against what the ledger says it should be. Pass { apply: true } to correct it. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json().catch(() => ({}));
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      const result = await reconcileAccountBalance(params.id, userId, userEmail ?? "Unknown", Boolean(body?.apply), firestore);
      return NextResponse.json({ success: true, result });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/accounts/[id]/reconcile POST");
  }
}
