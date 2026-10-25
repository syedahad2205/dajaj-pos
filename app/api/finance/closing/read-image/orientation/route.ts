import { NextResponse } from "next/server";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { financeErrorResponse } from "@/lib/financeApiError";
import { detectSheetTitleEdge } from "@/lib/geminiDailyClosingVision";

export const dynamic = "force-dynamic";

/**
 * POST { imageBase64 (small thumbnail), mimeType } → { edge: "top" | "right" | "bottom" | "left" | null }
 * Which way the sheet faces, so the browser can rotate the photo upright before
 * the real read (see detectSheetTitleEdge). Never writes anything.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { cleanup } = await getAuthenticatedFirestoreForRequest(request); // signed-in finance users only
    try {
      const raw = String(body.imageBase64 ?? "");
      const match = /^data:([^;]+);base64,([\s\S]*)$/.exec(raw);
      const edge = await detectSheetTitleEdge(match ? match[2] : raw, String(body.mimeType ?? match?.[1] ?? "image/jpeg"));
      return NextResponse.json({ success: true, edge });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/closing/read-image/orientation POST");
  }
}
