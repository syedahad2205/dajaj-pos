import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { getAdminAuth } from "@/lib/firebaseAdmin";
import { deleteFinanceUser, updateFinanceUser } from "@/services/financeUsersService";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      await updateFinanceUser(
        params.id,
        {
          fullName: body.fullName,
          username: body.username,
          active: body.active,
        },
        userId,
        userEmail ?? "Unknown",
        firestore,
      );
      if (body.active === false) {
        await getAdminAuth().revokeRefreshTokens(params.id);
      }
      return NextResponse.json({ success: true });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/users/[id] PATCH");
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      await deleteFinanceUser(params.id, userId, userEmail ?? "Unknown", firestore);
      return NextResponse.json({ success: true });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/users/[id] DELETE");
  }
}
