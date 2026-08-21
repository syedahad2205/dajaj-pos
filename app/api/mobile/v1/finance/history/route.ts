import { NextResponse } from "next/server";
import { getFinanceHistoryRange } from "@/services/financeDashboardService";
import {
  verifyFinanceAccessRequest,
  extractBearerToken,
  getFinanceUserFirestoreClient,
} from "@/lib/mobileFinanceAuth";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
 * GET /api/mobile/v1/finance/history?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
 *
 * Per-day closings with blended expense figures (cash + non-cash ledger
 * transactions) so the mobile History tab matches the web dashboard's
 * Revenue vs Expense semantics.
 */
export async function GET(request: Request) {
  const verified = await verifyFinanceAccessRequest(request);
  if (!verified.ok) return verified.response;

  const url = new URL(request.url);
  const dateFrom = url.searchParams.get("dateFrom") ?? "";
  const dateTo = url.searchParams.get("dateTo") ?? "";

  if (!DATE_RE.test(dateFrom) || !DATE_RE.test(dateTo) || dateFrom > dateTo) {
    return NextResponse.json(
      { success: false, message: "Invalid range: need dateFrom <= dateTo as YYYY-MM-DD." },
      { status: 400 },
    );
  }

  const idToken = extractBearerToken(request)!;
  const { firestore, cleanup } = await getFinanceUserFirestoreClient(idToken);

  try {
    const closings = await getFinanceHistoryRange(dateFrom, dateTo, firestore);
    const response = NextResponse.json({
      success: true,
      closings,
      serverTime: new Date().toISOString(),
    });
    response.headers.set("Access-Control-Allow-Origin", "*");
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load history.";
    const response = NextResponse.json({ success: false, message }, { status: 400 });
    response.headers.set("Access-Control-Allow-Origin", "*");
    return response;
  } finally {
    await cleanup();
  }
}
