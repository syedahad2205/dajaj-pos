import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { addDailyClosingExpense, addDailyClosingExpenses, type AddExpenseInput } from "@/services/financeClosingService";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { date: string } }) {
  try {
    const body = await request.json();
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      // Batch save: the UI lets managers add several expense lines in one
      // popup and submit them together. Body.expenses is an array of rows;
      // if present we save them all in a single transaction. A single-row
      // call (legacy / mobile) still works via the singular form.
      if (Array.isArray(body.expenses)) {
        const rows: AddExpenseInput[] = body.expenses.map((e: Record<string, unknown>) => ({
          categoryId: e.categoryId as string,
          amount: Number(e.amount),
          remarks: (e.remarks as string) ?? "",
          subcategoryId: (e.subcategoryId as string) ?? null,
          subcategoryName: (e.subcategoryName as string) ?? null,
        }));
        const closing = await addDailyClosingExpenses(params.date, rows, userId, userEmail ?? "Unknown", firestore);
        return NextResponse.json({ success: true, closing });
      }

      const closing = await addDailyClosingExpense(
        params.date,
        {
          categoryId: body.categoryId,
          amount: Number(body.amount),
          remarks: body.remarks,
          subcategoryId: body.subcategoryId ?? null,
          subcategoryName: body.subcategoryName ?? null,
        },
        userId,
        userEmail ?? "Unknown",
        firestore,
      );
      return NextResponse.json({ success: true, closing });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/closing/[date]/expenses POST");
  }
}
