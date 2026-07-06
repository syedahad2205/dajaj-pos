import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { getFinanceAuditLogs } from "@/services/financeAuditService";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { cleanup, firestore } = await getAuthenticatedFirestoreForRequest(request);
    try {
      const url = new URL(request.url);
      const logs = await getFinanceAuditLogs(
        {
          module: (url.searchParams.get("module") as never) ?? undefined,
          entityId: url.searchParams.get("entityId") ?? undefined,
          limitCount: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
        },
        firestore,
      );
      return NextResponse.json({ success: true, logs });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/audit-logs GET");
  }
}
