import { NextResponse } from "next/server";
import { getDailyClosingWorkTarget } from "@/services/financeClosingService";
import { financeErrorResponse } from "@/lib/financeApiError";
import { verifyFinanceAccessRequest, getFinanceUserFirestoreClient, extractBearerToken } from "@/lib/mobileFinanceAuth";

export const dynamic = "force-dynamic";

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

export async function GET(request: Request) {
  try {
    const verified = await verifyFinanceAccessRequest(request);
    if (!verified.ok) {
      const errorResponse = verified.response;
      errorResponse.headers.set("Access-Control-Allow-Origin", "*");
      errorResponse.headers.set("Access-Control-Allow-Credentials", "true");
      return errorResponse;
    }

    const idToken = extractBearerToken(request)!;
    const { firestore, cleanup } = await getFinanceUserFirestoreClient(idToken);
    try {
      const target = await getDailyClosingWorkTarget(firestore);
      const response = NextResponse.json({
        success: true,
        ...target,
        serverTime: new Date().toISOString(),
      });
      response.headers.set("Access-Control-Allow-Origin", "*");
      response.headers.set("Access-Control-Allow-Credentials", "true");
      return response;
    } finally {
      await cleanup();
    }
  } catch (error) {
    const errorResponse = financeErrorResponse(error, " [mobile GET closing work-date]");
    errorResponse.headers.set("Access-Control-Allow-Origin", "*");
    errorResponse.headers.set("Access-Control-Allow-Credentials", "true");
    return errorResponse;
  }
}
