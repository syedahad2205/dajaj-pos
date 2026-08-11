import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { addDailyClosingExpense, addDailyClosingExpenses, type AddExpenseInput } from "@/services/financeClosingService";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { date: string } }) {
  const tStart = Date.now();
  let cleanup: (() => Promise<void>) | undefined;
  try {
    const body = await request.json();
    const authResult = await getAuthenticatedFirestoreForRequest(request);
    cleanup = authResult.cleanup;
    const { firestore, userId, userEmail } = authResult;
    const tAuthed = Date.now();

    // Batch save: the UI lets managers add several expense lines in one
    // popup and submit them together. Body.expenses is an array of rows;
    // if present we save them all in a single transaction. A single-row
    // call (legacy / mobile) still works via the singular form.
    let closing;
    if (Array.isArray(body.expenses)) {
      const rows: AddExpenseInput[] = body.expenses.map((e: Record<string, unknown>) => ({
        categoryId: e.categoryId as string,
        amount: Number(e.amount),
        remarks: (e.remarks as string) ?? "",
        subcategoryId: (e.subcategoryId as string) ?? null,
        subcategoryName: (e.subcategoryName as string) ?? null,
      }));
      closing = await addDailyClosingExpenses(params.date, rows, userId, userEmail ?? "Unknown", firestore);
    } else {
      closing = await addDailyClosingExpense(
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
    }
    const tSaved = Date.now();
    console.log(
      `[closing/expenses] auth=${tAuthed - tStart}ms save=${tSaved - tAuthed}ms total=${tSaved - tStart}ms`,
    );

    // Tear down the ephemeral per-request Firebase app in the background —
    // it has no bearing on the response, so don't make the caller wait on it.
    void cleanup().catch((err) => console.error("[closing/expenses] cleanup failed", err));
    return NextResponse.json({ success: true, closing });
  } catch (error) {
    if (cleanup) void cleanup().catch(() => undefined);
    return financeErrorResponse(error, "/closing/[date]/expenses POST");
  }
}
