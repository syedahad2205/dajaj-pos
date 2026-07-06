import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { toDateKey } from "@/lib/finance";
import { getDailyClosingsForRange, getMissingAutoPostEventKeys } from "@/services/financeClosingService";

export const dynamic = "force-dynamic";

/** History of Daily Closing registers within a date range — used by Reports, the Dashboard, and Pigmi/Lock settings. */
export async function GET(request: Request) {
  try {
    const { cleanup, firestore } = await getAuthenticatedFirestoreForRequest(request);
    try {
      const url = new URL(request.url);
      const today = toDateKey();
      const dateFrom = url.searchParams.get("dateFrom") ?? today;
      const dateTo = url.searchParams.get("dateTo") ?? today;
      const rawClosings = await getDailyClosingsForRange(dateFrom, dateTo, firestore);
      // needsBackfill is computed fresh on every read, never stored — it's
      // the gap between "events this day's numbers should have posted" and
      // "events actually recorded in autoPostedTransactionsByEvent", which
      // is a stronger signal than postingWarnings (empty both when nothing's
      // wrong AND for days closed before auto-posting existed at all).
      const closings = rawClosings.map((closing) => {
        const missingEventKeys = closing.locked ? getMissingAutoPostEventKeys(closing) : [];
        return { ...closing, needsBackfill: missingEventKeys.length > 0, missingEventKeys };
      });
      return NextResponse.json({ success: true, closings });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/closing GET");
  }
}
