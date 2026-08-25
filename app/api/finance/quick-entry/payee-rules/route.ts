import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { requireAdminCaller } from "@/lib/financeRouteAuth";
import { financeErrorResponse } from "@/lib/financeApiError";
import { createPayeeRule, getPayeeRules, seedDefaultPayeeRules } from "@/services/quickEntryPayeeRulesService";

export const dynamic = "force-dynamic";

// Read is open to Finance Manager + Admin (Quick Entry itself needs to
// read active rules while analysing a screenshot). Managing rules — spec
// §25's "configurable... for future rules" — is kept Admin-only, matching
// how Finance Defaults (the closest existing analogue) is also Admin-only.
export async function GET(request: Request) {
  try {
    const { cleanup, firestore } = await getAuthenticatedFirestoreForRequest(request);
    try {
      const url = new URL(request.url);
      const includeInactive = url.searchParams.get("includeInactive") === "true";
      const rules = await getPayeeRules({ includeInactive }, firestore);
      return NextResponse.json({ success: true, rules });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/quick-entry/payee-rules GET");
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      await requireAdminCaller(firestore, userId);

      if (body?.seedDefaults) {
        await seedDefaultPayeeRules(userId, userEmail ?? "Admin", firestore);
        const rules = await getPayeeRules({ includeInactive: true }, firestore);
        return NextResponse.json({ success: true, rules });
      }

      const rule = await createPayeeRule(
        { payeeLabel: body.payeeLabel, categoryId: body.categoryId },
        userId,
        userEmail ?? "Admin",
        firestore,
      );
      return NextResponse.json({ success: true, rule });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/quick-entry/payee-rules POST");
  }
}
