import { NextResponse } from "next/server";
import { getFinanceDashboardSummary } from "@/services/financeDashboardService";
import {
  verifyFinanceAccessRequest,
  extractBearerToken,
  getFinanceUserFirestoreClient,
} from "@/lib/mobileFinanceAuth";

export const dynamic = "force-dynamic";

// Handle CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, X-Auth-Token, Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}

/**
 * GET /api/mobile/v1/finance/dashboard
 *
 * Same blended summary the web finance dashboard shows: Daily Closing owns
 * cash-drawer figures; Transactions feed bank revenue/expense into Monthly
 * cards and trend data. Reusing getFinanceDashboardSummary() guarantees the
 * phone matches the web by construction.
 */
export async function GET(request: Request) {
  const verified = await verifyFinanceAccessRequest(request);
  if (!verified.ok) return verified.response;

  const idToken = extractBearerToken(request)!;
  const { firestore, cleanup } = await getFinanceUserFirestoreClient(idToken);

  try {
    const summary = await getFinanceDashboardSummary(firestore);
    const response = NextResponse.json({
      success: true,
      summary,
      serverTime: new Date().toISOString(),
    });
    response.headers.set("Access-Control-Allow-Origin", "*");
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load dashboard.";
    const response = NextResponse.json({ success: false, message }, { status: 400 });
    response.headers.set("Access-Control-Allow-Origin", "*");
    return response;
  } finally {
    await cleanup();
  }
}
