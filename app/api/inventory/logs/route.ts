import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest, isFirebaseRouteAuthError } from "@/lib/firebaseServerApp";
import { getInventoryLogs } from "@/services/inventoryService";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { cleanup, firestore } = await getAuthenticatedFirestoreForRequest(request);

    try {
      const logs = await getInventoryLogs(firestore);
      return NextResponse.json({ success: true, logs });
    } finally {
      await cleanup();
    }
  } catch (error) {
    console.error("[inventory/logs]", error);
    const errorCode =
      typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
    const status = isFirebaseRouteAuthError(error) ? 401 : errorCode === "permission-denied" ? 403 : 500;
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Failed to load inventory logs." },
      { status },
    );
  }
}
