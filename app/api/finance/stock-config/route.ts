import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { requireAdminCaller } from "@/lib/financeRouteAuth";
import { financeErrorResponse } from "@/lib/financeApiError";
import { getStockPricingConfig, saveStockPricingConfig } from "@/services/financeClosingService";

export const dynamic = "force-dynamic";

/** GET — stock items and prices (Admin + Finance Manager). */
export async function GET(request: Request) {
  try {
    const { cleanup, firestore } = await getAuthenticatedFirestoreForRequest(request);
    try {
      return NextResponse.json({ success: true, config: await getStockPricingConfig(firestore) });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/stock-config GET");
  }
}

/** PUT { items: [{ id, name, unitPrice, active }], shawarmaPrices: { … } } — Admin-only. */
export async function PUT(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      await requireAdminCaller(firestore, userId);
      const config = await saveStockPricingConfig(body, userId, userEmail ?? "Unknown", firestore);
      return NextResponse.json({ success: true, config });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/stock-config PUT");
  }
}
