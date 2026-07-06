import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { toDateKey } from "@/lib/finance";
import { getAccountStatement } from "@/services/financeTransactionsService";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const { cleanup, firestore } = await getAuthenticatedFirestoreForRequest(request);
    try {
      const url = new URL(request.url);
      const today = toDateKey();
      const dateFrom = url.searchParams.get("dateFrom") ?? today;
      const dateTo = url.searchParams.get("dateTo") ?? today;
      const statement = await getAccountStatement(params.id, dateFrom, dateTo, firestore);
      return NextResponse.json({ success: true, statement });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/accounts/[id]/statement GET");
  }
}
