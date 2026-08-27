import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { requireAdminCaller } from "@/lib/financeRouteAuth";
import { financeErrorResponse } from "@/lib/financeApiError";
import { clearFinanceAiChatHistory } from "@/services/financeAiChatService";

export const dynamic = "force-dynamic";

/** Non-destructive "clear chat" — see clearFinanceAiChatHistory. Admin-only, same as the sibling /ai-chat routes. */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      await requireAdminCaller(firestore, userId);
      await clearFinanceAiChatHistory(userId, userEmail ?? "Admin", firestore, body.branchId);
      return NextResponse.json({ success: true });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/ai-chat/clear POST");
  }
}
