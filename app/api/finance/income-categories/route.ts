import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { createIncomeCategory, getIncomeCategories } from "@/services/financeCategoriesService";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { cleanup, firestore } = await getAuthenticatedFirestoreForRequest(request);
    try {
      const url = new URL(request.url);
      const includeInactive = url.searchParams.get("includeInactive") === "true";
      const categories = await getIncomeCategories({ includeInactive }, firestore);
      return NextResponse.json({ success: true, categories });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/income-categories GET");
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      const category = await createIncomeCategory(
        { name: body.name, icon: body.icon, color: body.color, description: body.description },
        userId,
        userEmail ?? "Unknown",
        firestore,
      );
      return NextResponse.json({ success: true, category });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/income-categories POST");
  }
}
