import { addDailyClosingDeposit, type AddDepositInput } from "@/services/financeClosingService";
import { withMobileAuth } from "@/lib/mobileRouteHelpers";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/finance/closing/[date]/deposits — Add a cash deposit line (Pigmi etc.) */
export async function POST(request: Request, { params }: { params: { date: string } }) {
  return withMobileAuth<AddDepositInput & { idempotencyKey?: string; deviceTime?: string }>(
    request,
    ({ uid, fullName, firestore, body }) =>
      addDailyClosingDeposit(params.date, body, uid, fullName, firestore),
  );
}
