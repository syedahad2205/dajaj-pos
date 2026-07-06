import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { deleteFinanceDefault, updateFinanceDefault } from "@/services/financeDefaultsService";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      await updateFinanceDefault(
        params.id,
        {
          eventName: body.eventName,
          destinationAccountId: body.destinationAccountId,
          description: body.description,
          isActive: body.isActive,
          displayOrder: body.displayOrder,
        },
        userId,
        userEmail ?? "Unknown",
        firestore,
      );
      return NextResponse.json({ success: true });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/defaults/[id] PATCH");
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      await deleteFinanceDefault(params.id, userId, userEmail ?? "Unknown", firestore);
      return NextResponse.json({ success: true });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/defaults/[id] DELETE");
  }
}
