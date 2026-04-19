import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest, isFirebaseRouteAuthError } from "@/lib/firebaseServerApp";
import { getInventoryReportForDate } from "@/services/inventoryService";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: { date: string } },
) {
  try {
    const date = params.date;
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) {
      return NextResponse.json({ success: false, message: "Invalid date format. Use YYYY-MM-DD." }, { status: 400 });
    }

    console.log(`[inventory/date] Fetching report for date: ${date}`);
    const { cleanup, firestore } = await getAuthenticatedFirestoreForRequest(request);

    try {
      const report = await getInventoryReportForDate(date, firestore);
      console.log(`[inventory/date] Report generated successfully with ${report.items.length} items`);
      return NextResponse.json({ success: true, report });
    } finally {
      await cleanup();
    }
  } catch (error) {
    console.error("[inventory/date] Error fetching inventory report:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : "";
    console.error("[inventory/date] Stack:", errorStack);
    const errorCode =
      typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
    const status = isFirebaseRouteAuthError(error) ? 401 : errorCode === "permission-denied" ? 403 : 500;

    return NextResponse.json(
      {
        success: false,
        message: `Failed to load inventory report: ${errorMessage}`,
        error: process.env.NODE_ENV === "development" ? errorStack : undefined,
      },
      { status }
    );
  }
}
