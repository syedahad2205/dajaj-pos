import { NextResponse } from "next/server";
import { verifyFinanceAccessRequest, type MobileFinanceRole } from "@/lib/mobileFinanceAuth";

export const dynamic = "force-dynamic";

// Handle CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, X-Auth-Token, Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}

/**
 * GET /api/mobile/v1/finance/auth/whoami
 *
 * Resolves the signed-in Firebase Auth user's finance identity for the
 * React Native app. Called right after signInWithEmailAndPassword —
 * Firebase handles authentication; this route answers authorization:
 * which role (admin | financeManager) and display name.
 *
 * Returns 403 if the account has no finance access (e.g. a customer account).
 */
export async function GET(request: Request) {
  const verified = await verifyFinanceAccessRequest(request);
  if (!verified.ok) {
    return verified.response;
  }

  const response = NextResponse.json({
    success: true,
    uid: verified.uid,
    role: verified.role as MobileFinanceRole,
    fullName: verified.fullName,
    email: verified.email,
  });

  response.headers.set("Access-Control-Allow-Origin", "*");
  return response;
}
