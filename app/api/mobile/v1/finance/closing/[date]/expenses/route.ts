import { addDailyClosingExpense, addDailyClosingExpenses, type AddExpenseInput } from "@/services/financeClosingService";
import { withMobileAuth } from "@/lib/mobileRouteHelpers";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/finance/closing/[date]/expenses — Add one or many cash expenses to a day's register. */
export async function POST(request: Request, { params }: { params: { date: string } }) {
  return withMobileAuth<
    ({ idempotencyKey?: string; deviceTime?: string } & (AddExpenseInput | { expenses: AddExpenseInput[] }))
  >(request, ({ uid, fullName, firestore, body }) => {
    if (Array.isArray((body as { expenses?: unknown }).expenses)) {
      const expenses = (body as { expenses: AddExpenseInput[] }).expenses.map((e) => ({
        categoryId: e.categoryId,
        amount: Number(e.amount),
        remarks: e.remarks,
        subcategoryId: e.subcategoryId ?? null,
        subcategoryName: e.subcategoryName ?? null,
      }));
      return addDailyClosingExpenses(params.date, expenses, uid, fullName, firestore);
    }
    const single = body as AddExpenseInput;
    return addDailyClosingExpense(
      params.date,
      {
        categoryId: single.categoryId,
        amount: Number(single.amount),
        remarks: single.remarks,
        subcategoryId: single.subcategoryId ?? null,
        subcategoryName: single.subcategoryName ?? null,
      },
      uid,
      fullName,
      firestore,
    );
  });
}
