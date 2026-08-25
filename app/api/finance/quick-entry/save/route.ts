import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { EMPTY_AI_EXTRACTION } from "@/lib/quickEntry";
import { saveQuickEntryTransaction } from "@/services/quickEntryService";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      const { transaction } = await saveQuickEntryTransaction(
        {
          amount: Number(body.amount),
          date: body.date,
          time: body.time,
          accountId: body.accountId,
          payee: body.payee ?? "",
          categoryId: body.categoryId,
          paymentMethod: body.paymentMethod ?? null,
          referenceNumber: body.referenceNumber ?? "",
          notes: body.notes ?? "",
          aiExtracted: body.aiExtracted ?? EMPTY_AI_EXTRACTION,
          matchedPayeeRuleId: body.matchedPayeeRuleId ?? null,
          duplicateOverridden: Boolean(body.duplicateOverridden),
          branchId: body.branchId,
        },
        userId,
        userEmail ?? "Finance Manager",
        firestore,
      );
      return NextResponse.json({ success: true, transaction });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/quick-entry/save POST");
  }
}
