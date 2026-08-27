import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { requireAdminCaller } from "@/lib/financeRouteAuth";
import { financeErrorResponse } from "@/lib/financeApiError";
import { getFinanceAiChatHistory, sendFinanceAiChatMessage } from "@/services/financeAiChatService";

export const dynamic = "force-dynamic";

/** Strips an optional "data:image/png;base64," prefix so the service always receives raw base64 — same helper shape as every other image-upload route in this app. */
function stripDataUrlPrefix(value: string): { base64: string; mimeTypeFromPrefix: string | null } {
  const match = /^data:([^;]+);base64,([\s\S]*)$/.exec(value);
  if (match) return { base64: match[2], mimeTypeFromPrefix: match[1] };
  return { base64: value, mimeTypeFromPrefix: null };
}

// Admin-only feature end to end (see firestore.rules — finance_ai_chat_messages
// is gated to isAdmin() alone, unlike most fin_*/quick_entry_* collections
// which also allow Finance Manager). requireAdminCaller here is a belt-and-
// suspenders check on top of that, matching the convention already used by
// /closing/backfill-cash-recount for money-movement-adjacent routes.
export async function GET(request: Request) {
  try {
    const { cleanup, firestore, userId } = await getAuthenticatedFirestoreForRequest(request);
    try {
      await requireAdminCaller(firestore, userId);
      const messages = await getFinanceAiChatHistory(firestore);
      return NextResponse.json({ success: true, messages });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/ai-chat/messages GET");
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      await requireAdminCaller(firestore, userId);

      const rawImages = Array.isArray(body.images) ? body.images : [];
      const images = rawImages.map((img: { data?: string; mimeType?: string }) => {
        const { base64, mimeTypeFromPrefix } = stripDataUrlPrefix(String(img?.data ?? ""));
        return { base64Data: base64, mimeType: String(img?.mimeType ?? mimeTypeFromPrefix ?? "") };
      });

      const result = await sendFinanceAiChatMessage(
        { text: String(body.text ?? ""), images, branchId: body.branchId },
        userId,
        userEmail ?? "Admin",
        firestore,
      );
      return NextResponse.json({ success: true, ...result });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/ai-chat/messages POST");
  }
}
