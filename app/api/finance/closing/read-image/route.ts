import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { analyzeDailyClosingImage } from "@/services/dailyClosingImageService";

export const dynamic = "force-dynamic";

/**
 * Stateless analysis only — never touches fin_daily_closing or any other
 * finance table. Not nested under /closing/[date]/ on purpose: reading a
 * sheet's contents doesn't depend on which day's document is currently
 * open, and applying the result still goes through the EXISTING
 * POST /api/finance/closing/[date]/expenses route from the client, once
 * the Finance Manager has reviewed it.
 *
 * No requireAdminCaller — Finance Managers already have full read/write on
 * fin_daily_closing and fin_expense_categories per firestore.rules, and
 * this route only reads the latter.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cleanup, firestore } = await getAuthenticatedFirestoreForRequest(request);
    try {
      const raw = String(body.imageBase64 ?? "");
      const match = /^data:([^;]+);base64,([\s\S]*)$/.exec(raw);
      const base64Data = match ? match[2] : raw;
      const mimeType = String(body.mimeType ?? match?.[1] ?? "");

      const result = await analyzeDailyClosingImage({ base64Data, mimeType, branchId: body.branchId }, firestore);
      return NextResponse.json({ success: true, ...result });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/closing/read-image POST");
  }
}
