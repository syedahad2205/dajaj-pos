import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { createFinanceUser, getFinanceUsers } from "@/services/financeUsersService";

export const dynamic = "force-dynamic";

// Admin-only, same as every other Finance module route — auth is enforced
// by getAuthenticatedFirestoreForRequest (Firebase ID token) plus the
// finance_auth Firestore rule (isAdmin()). Finance Users themselves never
// call this route; they don't have a Firebase Auth session to present.

export async function GET(request: Request) {
  try {
    const { cleanup, firestore } = await getAuthenticatedFirestoreForRequest(request);
    try {
      const users = await getFinanceUsers({}, firestore);
      return NextResponse.json({ success: true, users });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/users GET");
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      if (body.password !== body.confirmPassword) {
        throw new Error("Password and confirm password do not match.");
      }
      const user = await createFinanceUser(
        {
          fullName: body.fullName,
          username: body.username,
          password: body.password,
        },
        userId,
        userEmail ?? "Unknown",
        firestore,
      );
      return NextResponse.json({ success: true, user });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/users POST");
  }
}
