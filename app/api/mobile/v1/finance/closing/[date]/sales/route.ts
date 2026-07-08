import { updateDailyClosingSales, type UpdateSalesInput } from "@/services/financeClosingService";
import { withMobileAuth } from "@/lib/mobileRouteHelpers";

export const dynamic = "force-dynamic";

/** PATCH /api/mobile/v1/finance/closing/[date]/sales — Update the day's manually-entered sales totals. */
export async function PATCH(request: Request, { params }: { params: { date: string } }) {
  return withMobileAuth<UpdateSalesInput & { idempotencyKey?: string; deviceTime?: string }>(
    request,
    ({ firestore, body }) =>
      updateDailyClosingSales(params.date, body, firestore),
  );
}
