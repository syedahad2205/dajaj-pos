import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { requireAdminCaller } from "@/lib/financeRouteAuth";
import { getFinanceDashboardSummary } from "@/services/financeDashboardService";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { cleanup, firestore, userId } = await getAuthenticatedFirestoreForRequest(request);
    try {
      const [summary, isAdmin] = await Promise.all([
        getFinanceDashboardSummary(firestore),
        requireAdminCaller(firestore, userId).then(() => true, () => false),
      ]);
      // Owner payouts are Admin-only information.
      if (!isAdmin) {
        delete summary.cards.monthlyWithdrawn;
        delete summary.cards.monthlyWithdrawnOwner;
        delete summary.cards.monthlyWithdrawnPartner;
        delete summary.cards.monthlyRetainedProfit;
      }
      return NextResponse.json({ success: true, summary });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/dashboard GET");
  }
}
