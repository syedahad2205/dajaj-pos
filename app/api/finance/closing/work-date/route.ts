import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { getDailyClosingWorkTarget } from "@/services/financeClosingService";

export const dynamic = "force-dynamic";

/** The date Daily Closing should open on: the day after the last locked close. */
export async function GET(request: Request) {
  try {
    const { cleanup, firestore } = await getAuthenticatedFirestoreForRequest(request);
    try {
      const target = await getDailyClosingWorkTarget(firestore);
      return NextResponse.json({ success: true, ...target });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/closing/work-date GET");
  }
}
