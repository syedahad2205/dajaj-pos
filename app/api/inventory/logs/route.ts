import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest, isFirebaseRouteAuthError } from "@/lib/firebaseServerApp";
import { getInventoryLogs } from "@/services/inventoryService";
import { Timestamp } from "firebase/firestore";

export const dynamic = "force-dynamic";

function serializeTimestamp(value: unknown): string | null {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (
    typeof value === "object" &&
    value !== null &&
    "seconds" in value &&
    typeof (value as Record<string, unknown>).seconds === "number"
  ) {
    return new Date(
      ((value as { seconds: number }).seconds) * 1000,
    ).toISOString();
  }
  if (typeof value === "string") return value;
  return null;
}

export async function GET(request: Request) {
  try {
    const { cleanup, firestore } = await getAuthenticatedFirestoreForRequest(request);

    try {
      const logs = await getInventoryLogs(firestore);
      const serialized = logs.map((log) => ({
        ...log,
        timestamp: serializeTimestamp(log.timestamp),
      }));
      return NextResponse.json({ success: true, logs: serialized });
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
