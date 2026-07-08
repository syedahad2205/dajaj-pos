import { NextResponse } from "next/server";
import { getDailyClosingView, closeDailyClosing } from "@/services/financeClosingService";
import { withMobileAuth } from "@/lib/mobileRouteHelpers";
import { financeErrorResponse } from "@/lib/financeApiError";
import { verifyFinanceUserRequest, getFinanceUserFirestoreClient, extractBearerToken } from "@/lib/mobileFinanceAuth";

export const dynamic = "force-dynamic";

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
    if (!verified.ok) return verified.response;

    const idToken = extractBearerToken(request)!;
    const { firestore, cleanup } = await getFinanceUserFirestoreClient(idToken);
    try {
      const closing = await getDailyClosingView(params.date, firestore);
      return NextResponse.json({ success: true, closing, serverTime: new Date().toISOString() });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, " [mobile GET closing]");
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
