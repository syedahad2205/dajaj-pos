import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { createFinanceVendor, getFinanceVendors } from "@/services/financeVendorsService";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { cleanup, firestore } = await getAuthenticatedFirestoreForRequest(request);
    try {
      const url = new URL(request.url);
      const includeInactive = url.searchParams.get("includeInactive") === "true";
      const vendors = await getFinanceVendors({ includeInactive }, firestore);
      return NextResponse.json({ success: true, vendors });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/vendors GET");
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      const vendor = await createFinanceVendor(
        {
          name: body.name,
          phone: body.phone,
          gstNumber: body.gstNumber,
          address: body.address,
          notes: body.notes,
          defaultExpenseCategoryId: body.defaultExpenseCategoryId ?? null,
          defaultExpenseCategoryName: body.defaultExpenseCategoryName ?? null,
        },
        userId,
        userEmail ?? "Unknown",
        firestore,
      );
      return NextResponse.json({ success: true, vendor });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/vendors POST");
  }
}
