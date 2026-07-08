import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { getAdminAuth } from "@/lib/firebaseAdmin";
import { changeFinancePassword } from "@/services/financeUsersService";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      if (body.password !== body.confirmPassword) {
        throw new Error("Password and confirm password do not match.");
      }
      await changeFinancePassword(params.id, body.password, userId, userEmail ?? "Unknown", firestore, async (uid) => {
        await getAdminAuth().revokeRefreshTokens(uid);
      });
      return NextResponse.json({ success: true });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/users/[id]/password POST");
  }
}
