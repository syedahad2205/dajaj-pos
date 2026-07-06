import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { createFinanceAccount, getFinanceAccounts, seedDefaultFinanceAccounts } from "@/services/financeAccountsService";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { cleanup, firestore } = await getAuthenticatedFirestoreForRequest(request);
    try {
      const url = new URL(request.url);
      const includeArchived = url.searchParams.get("includeArchived") === "true";
      const accounts = await getFinanceAccounts({ includeArchived }, firestore);
      return NextResponse.json({ success: true, accounts });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/accounts GET");
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      if (body?.seedDefaults) {
        const created = await seedDefaultFinanceAccounts(userId, userEmail ?? "Unknown", undefined, firestore);
        return NextResponse.json({ success: true, created });
      }

      const account = await createFinanceAccount(
        {
          name: body.name,
          type: body.type,
          openingBalance: Number(body.openingBalance) || 0,
          description: body.description,
        },
        userId,
        userEmail ?? "Unknown",
        firestore,
      );
      return NextResponse.json({ success: true, account });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/accounts POST");
  }
}
