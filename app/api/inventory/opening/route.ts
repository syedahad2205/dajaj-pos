import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest, isFirebaseRouteAuthError } from "@/lib/firebaseServerApp";
import { saveInventoryOpening } from "@/services/inventoryService";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { date, itemId, openingStock } = body;

    if (!date || !itemId || typeof openingStock !== "number") {
      return NextResponse.json({ success: false, message: "Missing required opening stock parameters." }, { status: 400 });
    }

    const { cleanup, firestore, userEmail, userId } = await getAuthenticatedFirestoreForRequest(request);

    try {
      const entry = await saveInventoryOpening(
        date,
        itemId,
        openingStock,
        userId,
        userEmail ?? "Unknown",
        firestore,
      );
      return NextResponse.json({ success: true, entry });
    } finally {
      await cleanup();
    }
  } catch (error) {
    console.error("[inventory/opening]", error);
    const errorCode =
      typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
    const status = isFirebaseRouteAuthError(error) ? 401 : errorCode === "permission-denied" ? 403 : 500;
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Failed to save opening stock." },
      { status },
    );
  }
}
