import { setDailyClosingOpeningCash } from "@/services/financeClosingService";
import { withMobileAuth } from "@/lib/mobileRouteHelpers";

export const dynamic = "force-dynamic";

/** PATCH /api/mobile/v1/finance/closing/[date]/opening-cash — Set manual Opening Cash (only when openingCashSource == "manual"). */
export async function PATCH(request: Request, { params }: { params: { date: string } }) {
  return withMobileAuth<{ openingCash: number; idempotencyKey?: string; deviceTime?: string }>(
    request,
    ({ firestore, body }) =>
      setDailyClosingOpeningCash(params.date, body.openingCash, firestore),
  );
}
