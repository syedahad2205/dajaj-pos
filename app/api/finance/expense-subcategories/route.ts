import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { createExpenseSubcategory, getExpenseSubcategories } from "@/services/financeCategoriesService";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { cleanup, firestore } = await getAuthenticatedFirestoreForRequest(request);
    try {
      const url = new URL(request.url);
      const categoryId = url.searchParams.get("categoryId") ?? undefined;
      const includeInactive = url.searchParams.get("includeInactive") === "true";
      const subcategories = await getExpenseSubcategories({ categoryId, includeInactive }, firestore);
      return NextResponse.json({ success: true, subcategories });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/expense-subcategories GET");
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      const subcategory = await createExpenseSubcategory(
        { categoryId: body.categoryId, name: body.name },
        userId,
        userEmail ?? "Unknown",
        firestore,
      );
      return NextResponse.json({ success: true, subcategory });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/expense-subcategories POST");
  }
}
