import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { getFinanceDashboardSummary } from "@/services/financeDashboardService";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { cleanup, firestore } = await getAuthenticatedFirestoreForRequest(request);
    try {
      const summary = await getFinanceDashboardSummary(firestore);
      return NextResponse.json({ success: true, summary });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/dashboard GET");
  }
}
