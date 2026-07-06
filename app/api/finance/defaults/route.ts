import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { createFinanceDefault, getFinanceDefaults, migrateLegacySettlementDefaults, seedDefaultFinanceDefaults } from "@/services/financeDefaultsService";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      // Transparent one-time migration: old "Zomato/Swiggy Settlement" → bank
      // events become "Zomato/Swiggy Settlement Received" (same account),
      // freeing up the old keys for Daily Closing's new Escrow-bound events.
      // No-ops once already migrated.
      await migrateLegacySettlementDefaults(userId, userEmail ?? "Unknown", firestore);
      // Backfill any built-in events added after a business's Finance
      // Defaults were first seeded (e.g. "Zomato/Swiggy Sales" introduced
      // alongside the Escrow model). Only creates rows that don't exist yet
      // — never touches an existing mapping — so this is safe to run on
      // every page load.
      await seedDefaultFinanceDefaults(userId, userEmail ?? "Unknown", firestore);

      const url = new URL(request.url);
      const includeInactive = url.searchParams.get("includeInactive") === "true";
      const defaults = await getFinanceDefaults({ includeInactive }, firestore);
      return NextResponse.json({ success: true, defaults });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/defaults GET");
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      if (body?.seedDefaults) {
        const created = await seedDefaultFinanceDefaults(userId, userEmail ?? "Unknown", firestore);
        return NextResponse.json({ success: true, created });
      }

      const financeDefault = await createFinanceDefault(
        { eventName: body.eventName, destinationAccountId: body.destinationAccountId ?? null, description: body.description },
        userId,
        userEmail ?? "Unknown",
        firestore,
      );
      return NextResponse.json({ success: true, financeDefault });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/defaults POST");
  }
}
