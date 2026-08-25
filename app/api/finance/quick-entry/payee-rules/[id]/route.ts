import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { requireAdminCaller } from "@/lib/financeRouteAuth";
import { financeErrorResponse } from "@/lib/financeApiError";
import { updatePayeeRule } from "@/services/quickEntryPayeeRulesService";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const { cleanup, firestore, userId } = await getAuthenticatedFirestoreForRequest(request);
    try {
      await requireAdminCaller(firestore, userId);
      await updatePayeeRule(
        params.id,
        {
          payeeLabel: body.payeeLabel,
          categoryId: body.categoryId,
          active: body.active,
        },
        firestore,
      );
      return NextResponse.json({ success: true });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/quick-entry/payee-rules/[id] PATCH");
  }
}
