import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { analyzeQuickEntryScreenshot } from "@/services/quickEntryService";

export const dynamic = "force-dynamic";

/** Strips an optional "data:image/png;base64," prefix so the service always receives raw base64. */
function stripDataUrlPrefix(value: string): { base64: string; mimeTypeFromPrefix: string | null } {
  const match = /^data:([^;]+);base64,([\s\S]*)$/.exec(value);
  if (match) return { base64: match[2], mimeTypeFromPrefix: match[1] };
  return { base64: value, mimeTypeFromPrefix: null };
}

// No requireAdminCaller here on purpose — Quick Entry is a Finance Manager
// feature (spec §3), and Firestore rules already grant Finance Managers
// read/write on fin_accounts/fin_transactions/fin_expense_categories, which
// is everything this route touches read-only plus the new quick_entry_*
// collections (see firestore.rules).
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      const raw = String(body.imageBase64 ?? "");
      const { base64, mimeTypeFromPrefix } = stripDataUrlPrefix(raw);
      const mimeType = String(body.mimeType ?? mimeTypeFromPrefix ?? "");

      const result = await analyzeQuickEntryScreenshot(
        {
          base64Data: base64,
          mimeType,
          userId,
          userName: userEmail ?? "Finance Manager",
          branchId: body.branchId,
        },
        firestore,
      );
      return NextResponse.json({ success: true, ...result });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/quick-entry/analyze POST");
  }
}
