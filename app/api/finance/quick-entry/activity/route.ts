import { doc, getDoc } from "firebase/firestore";
import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { getQuickEntryActivity, logQuickEntryActivity } from "@/services/quickEntryService";
import { CLIENT_LOGGABLE_QUICK_ENTRY_ACTIONS } from "@/lib/quickEntry";

export const dynamic = "force-dynamic";

/**
 * Admin sees every Finance Manager's Quick Entry activity; a Finance
 * Manager sees only their own — same "own actions only" scoping already
 * used for the finance_auth mobile app, kept for consistency and so this
 * never becomes a way for one Finance Manager to see another's activity.
 */
export async function GET(request: Request) {
  try {
    const { cleanup, firestore, userId } = await getAuthenticatedFirestoreForRequest(request);
    try {
      const adminSnap = await getDoc(doc(firestore, "admins", userId));
      const isAdmin = adminSnap.exists();
      const logs = await getQuickEntryActivity({ onlyUserId: isAdmin ? undefined : userId }, firestore);
      return NextResponse.json({ success: true, logs });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/quick-entry/activity GET");
  }
}

/** Lets the frontend log view/cancel/category-changed/account-changed events that happen entirely client-side before any save. */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      if (!CLIENT_LOGGABLE_QUICK_ENTRY_ACTIONS.includes(body.action)) {
        return NextResponse.json({ success: false, message: "Unsupported activity action." }, { status: 400 });
      }
      await logQuickEntryActivity(
        {
          action: body.action,
          detail: body.detail ?? {},
          transactionId: body.transactionId ?? null,
          userId,
          userName: userEmail ?? "Finance Manager",
          branchId: body.branchId,
        },
        firestore,
      );
      return NextResponse.json({ success: true });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/quick-entry/activity POST");
  }
}
