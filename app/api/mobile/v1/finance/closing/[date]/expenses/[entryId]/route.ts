import { removeDailyClosingExpense } from "@/services/financeClosingService";
import { withMobileAuth } from "@/lib/mobileRouteHelpers";

export const dynamic = "force-dynamic";

/** DELETE /api/mobile/v1/finance/closing/[date]/expenses/[entryId] — Remove a cash expense line. */
export async function DELETE(request: Request, { params }: { params: { date: string; entryId: string } }) {
  return withMobileAuth<{ idempotencyKey?: string; deviceTime?: string }>(
    request,
    ({ uid, fullName, firestore }) =>
      removeDailyClosingExpense(params.date, params.entryId, uid, fullName, firestore),
  );
}
