import { NextResponse } from "next/server";
import { getDailyClosingView, closeDailyClosing } from "@/services/financeClosingService";
import { withMobileAuth } from "@/lib/mobileRouteHelpers";
import { financeErrorResponse } from "@/lib/financeApiError";
import { verifyFinanceUserRequest, getFinanceUserFirestoreClient, extractBearerToken } from "@/lib/mobileFinanceAuth";

export const dynamic = "force-dynamic";

// Handle CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,PATCH,OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

// NOTE: reopenDailyClosing and backfillDailyClosingPostings are NOT exposed
// here — they are Admin-only and remain on the existing web-facing routes only
// (app/api/finance/closing/[date]/reopen and /backfill). Per Requirement 4.4.

/**
 * GET /api/mobile/v1/finance/closing/[date]
 * Read a single day's Daily Closing document (or a freshly-computed empty draft).
 * Authorized by Finance User identity.
 */
export async function GET(request: Request, { params }: { params: { date: string } }) {
  try {
    const verified = await verifyFinanceUserRequest(request);
    if (!verified.ok) {
      // Add CORS headers to error response
      const errorResponse = verified.response;
      errorResponse.headers.set('Access-Control-Allow-Origin', '*');
      errorResponse.headers.set('Access-Control-Allow-Credentials', 'true');
      return errorResponse;
    }

    const idToken = extractBearerToken(request)!;
    const { firestore, cleanup } = await getFinanceUserFirestoreClient(idToken);
    try {
      const closing = await getDailyClosingView(params.date, firestore);
      const response = NextResponse.json({ 
        success: true, 
        closing, 
        serverTime: new Date().toISOString() 
      });
      
      // Add CORS headers to success response
      response.headers.set('Access-Control-Allow-Origin', '*');
      response.headers.set('Access-Control-Allow-Credentials', 'true');
      
      return response;
    } finally {
      await cleanup();
    }
  } catch (error) {
    const errorResponse = financeErrorResponse(error, " [mobile GET closing]");
    
    // Add CORS headers to error response
    errorResponse.headers.set('Access-Control-Allow-Origin', '*');
    errorResponse.headers.set('Access-Control-Allow-Credentials', 'true');
    
    return errorResponse;
  }
}

/**
 * PATCH /api/mobile/v1/finance/closing/[date]
 * Close (save + lock) a day's Daily Closing — the final "Save Daily Closing" action.
 * Body: { closingCash: number, idempotencyKey?: string, deviceTime?: string }
 */
export async function PATCH(request: Request, { params }: { params: { date: string } }) {
  return withMobileAuth<{ closingCash: number; idempotencyKey?: string; deviceTime?: string }>(
    request,
    ({ uid, fullName, firestore, body }) =>
      closeDailyClosing(params.date, body.closingCash, uid, fullName, firestore),
  );
}
