import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { requireAdminCaller } from "@/lib/financeRouteAuth";
import { financeErrorResponse } from "@/lib/financeApiError";
import { setFinanceAccountStatus, updateFinanceAccount } from "@/services/financeAccountsService";

export const dynamic = "force-dynamic";

// Admin-only, even for a Finance Manager who otherwise has write access to
// fin_accounts — editing/archiving an account outright is a Finance Settings action.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      await requireAdminCaller(firestore, userId);
      if (body?.status) {
        await setFinanceAccountStatus(params.id, body.status, userId, userEmail ?? "Unknown", firestore);
      } else {
        await updateFinanceAccount(
          params.id,
          { name: body.name, description: body.description, type: body.type, displayOrder: body.displayOrder },
          userId,
          userEmail ?? "Unknown",
          firestore,
        );
      }
      return NextResponse.json({ success: true });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/accounts/[id] PATCH");
  }
}
