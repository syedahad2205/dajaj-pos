import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { deleteIncomeCategory, updateIncomeCategory } from "@/services/financeCategoriesService";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      await updateIncomeCategory(
        params.id,
        {
          name: body.name,
          icon: body.icon,
          color: body.color,
          description: body.description,
          active: body.active,
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
    return financeErrorResponse(error, "/income-categories/[id] PATCH");
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      await deleteIncomeCategory(params.id, userId, userEmail ?? "Unknown", firestore);
      return NextResponse.json({ success: true });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/income-categories/[id] DELETE");
  }
}
