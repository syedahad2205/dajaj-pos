import { addDailyClosingExpense, type AddExpenseInput } from "@/services/financeClosingService";
import { withMobileAuth } from "@/lib/mobileRouteHelpers";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/finance/closing/[date]/expenses — Add a cash expense to a day's register. */
export async function POST(request: Request, { params }: { params: { date: string } }) {
  return withMobileAuth<AddExpenseInput & { idempotencyKey?: string; deviceTime?: string }>(
    request,
    ({ uid, fullName, firestore, body }) =>
      addDailyClosingExpense(params.date, body, uid, fullName, firestore),
  );
}
