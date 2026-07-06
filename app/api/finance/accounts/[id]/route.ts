import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { setFinanceAccountStatus, updateFinanceAccount } from "@/services/financeAccountsService";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
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
