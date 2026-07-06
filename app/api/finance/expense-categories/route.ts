import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { createExpenseCategory, getExpenseCategories, seedDefaultFinanceCategories } from "@/services/financeCategoriesService";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { cleanup, firestore } = await getAuthenticatedFirestoreForRequest(request);
    try {
      const url = new URL(request.url);
      const includeInactive = url.searchParams.get("includeInactive") === "true";
      const categories = await getExpenseCategories({ includeInactive }, firestore);
      return NextResponse.json({ success: true, categories });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/expense-categories GET");
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
    try {
      if (body?.seedDefaults) {
        const result = await seedDefaultFinanceCategories(userId, userEmail ?? "Unknown", undefined, firestore);
        return NextResponse.json({ success: true, ...result });
      }

      const category = await createExpenseCategory(
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
    return financeErrorResponse(error, "/expense-categories POST");
  }
}
