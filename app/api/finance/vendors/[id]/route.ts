import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { deleteFinanceVendor, updateFinanceVendor } from "@/services/financeVendorsService";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      await updateFinanceVendor(
        params.id,
        {
          name: body.name,
          phone: body.phone,
          gstNumber: body.gstNumber,
          address: body.address,
          notes: body.notes,
          defaultExpenseCategoryId: body.defaultExpenseCategoryId,
          defaultExpenseCategoryName: body.defaultExpenseCategoryName,
          active: body.active,
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
    return financeErrorResponse(error, "/vendors/[id] PATCH");
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      await deleteFinanceVendor(params.id, userId, userEmail ?? "Unknown", firestore);
      return NextResponse.json({ success: true });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/vendors/[id] DELETE");
  }
}
