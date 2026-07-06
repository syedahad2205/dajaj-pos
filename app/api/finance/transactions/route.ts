import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { toDateKey } from "@/lib/finance";
import { createFinanceTransaction, listFinanceTransactions } from "@/services/financeTransactionsService";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { cleanup, firestore } = await getAuthenticatedFirestoreForRequest(request);
    try {
      const url = new URL(request.url);
      const today = toDateKey();
      const dateFrom = url.searchParams.get("dateFrom") ?? today;
      const dateTo = url.searchParams.get("dateTo") ?? today;
      const page = await listFinanceTransactions(
        {
          dateFrom,
          dateTo,
          type: (url.searchParams.get("type") as never) ?? undefined,
          status: (url.searchParams.get("status") as never) ?? undefined,
          categoryId: url.searchParams.get("categoryId") ?? undefined,
          vendorId: url.searchParams.get("vendorId") ?? undefined,
          accountId: url.searchParams.get("accountId") ?? undefined,
          createdBy: url.searchParams.get("createdBy") ?? undefined,
          amountMin: url.searchParams.get("amountMin") ? Number(url.searchParams.get("amountMin")) : undefined,
          amountMax: url.searchParams.get("amountMax") ? Number(url.searchParams.get("amountMax")) : undefined,
          search: url.searchParams.get("search") ?? undefined,
          page: url.searchParams.get("page") ? Number(url.searchParams.get("page")) : undefined,
          pageSize: url.searchParams.get("pageSize") ? Number(url.searchParams.get("pageSize")) : undefined,
        },
        firestore,
      );
      return NextResponse.json({ success: true, ...page });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/transactions GET");
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      const transaction = await createFinanceTransaction(
        {
          type: body.type,
          date: body.date,
          time: body.time,
          categoryId: body.categoryId ?? null,
          subcategoryId: body.subcategoryId ?? null,
          description: body.description,
          amount: Number(body.amount),
          fromAccountId: body.fromAccountId ?? null,
          toAccountId: body.toAccountId ?? null,
          vendorId: body.vendorId ?? null,
          paymentMethod: body.paymentMethod ?? null,
          remarks: body.remarks,
          referenceNumber: body.referenceNumber,
        },
        userId,
        userEmail ?? "Unknown",
        firestore,
      );
      return NextResponse.json({ success: true, transaction });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/transactions POST");
  }
}
