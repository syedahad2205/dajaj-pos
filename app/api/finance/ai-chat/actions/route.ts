import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { requireAdminCaller } from "@/lib/financeRouteAuth";
import { financeErrorResponse } from "@/lib/financeApiError";
import { resolveFinanceAiAction } from "@/services/financeAiChatService";

export const dynamic = "force-dynamic";

/** Approves or discards one proposed action from a chat message — see services/financeAiChatService.ts for what "approve" actually dispatches to. Admin-only, same as the sibling /ai-chat/messages route. */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      await requireAdminCaller(firestore, userId);

      const decision = body.decision === "approve" || body.decision === "discard" ? body.decision : null;
      if (!decision) throw new Error("Invalid decision — must be 'approve' or 'discard'.");
      if (!body.messageId || !body.actionId) throw new Error("Missing messageId or actionId.");

      const action = await resolveFinanceAiAction(
        {
          messageId: String(body.messageId),
          actionId: String(body.actionId),
          decision,
          edits: body.edits ?? undefined,
          branchId: body.branchId,
        },
        userId,
        userEmail ?? "Admin",
        firestore,
      );
      return NextResponse.json({ success: true, action });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/ai-chat/actions POST");
  }
}
