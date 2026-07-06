import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { updateDailyClosingSales } from "@/services/financeClosingService";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: { date: string } }) {
  try {
    const body = await request.json();
    const { cleanup, firestore } = await getAuthenticatedFirestoreForRequest(request);
    try {
      const closing = await updateDailyClosingSales(
        params.date,
        {
          upiSales: body.upiSales !== undefined ? Number(body.upiSales) : undefined,
          zomatoSales: body.zomatoSales !== undefined ? Number(body.zomatoSales) : undefined,
          swiggySales: body.swiggySales !== undefined ? Number(body.swiggySales) : undefined,
          otherIncome: body.otherIncome !== undefined ? Number(body.otherIncome) : undefined,
        },
        firestore,
      );
      return NextResponse.json({ success: true, closing });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/closing/[date]/sales PATCH");
  }
}
