import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest, isFirebaseRouteAuthError } from "@/lib/firebaseServerApp";
import { saveInventoryClosing } from "@/services/inventoryService";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { date, itemId, closingStock } = body;

    if (!date || !itemId || typeof closingStock !== "number") {
      return NextResponse.json({ success: false, message: "Missing required closing stock parameters." }, { status: 400 });
    }

    const { cleanup, firestore, userEmail, userId } = await getAuthenticatedFirestoreForRequest(request);

    try {
      const entry = await saveInventoryClosing(
        date,
        itemId,
        closingStock,
        userId,
        userEmail ?? "Unknown",
        firestore,
      );
      return NextResponse.json({ success: true, entry });
    } finally {
      await cleanup();
    }
  } catch (error) {
    console.error("[inventory/closing]", error);
    const errorCode =
      typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
    const status = isFirebaseRouteAuthError(error) ? 401 : errorCode === "permission-denied" ? 403 : 500;
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Failed to save closing stock." },
      { status },
    );
  }
}
