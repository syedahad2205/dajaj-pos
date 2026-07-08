import { serverTimestamp } from "firebase/firestore";
import { NextResponse } from "next/server";
import { financeErrorResponse } from "@/lib/financeApiError";
import { getFinanceUserFirestoreClient, verifyFinanceUserRequest } from "@/lib/mobileFinanceAuth";
import { getIdempotencyRecord, writeIdempotencyRecord, type IdempotencyRecord } from "@/lib/mobileIdempotency";
import type { FinanceDailyClosing } from "@/lib/finance";

export { verifyFinanceUserRequest, getFinanceUserFirestoreClient };

/**
 * Reads the Authorization: Bearer <idToken> header without verifying it,
 * for passing to getFinanceUserFirestoreClient() after verifyFinanceUserRequest().
 */
export function extractBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim() || null;
}

/**
 * Wraps a mobile mutation route handler with the standard:
 * 1. Identity verification (verifyFinanceUserRequest)
 * 2. Idempotency check (if idempotencyKey is provided in body)
 * 3. Per-request Finance User Firestore client creation
 * 4. Handler execution
 * 5. Idempotency record write
 * 6. Cleanup
 *
 * `handler` receives { uid, fullName, firestore, body } and must return
 * the FinanceDailyClosing from the service call.
 */
export async function withMobileAuth<B>(
  request: Request,
  handler: (ctx: {
    uid: string;
    fullName: string;
    firestore: ReturnType<typeof import("firebase/firestore").getFirestore>;
    body: B;
  }) => Promise<FinanceDailyClosing>,
): Promise<NextResponse> {
  try {
    // 1. Verify identity
    const verified = await verifyFinanceUserRequest(request);
    if (!verified.ok) return verified.response;
    const { uid, fullName } = verified;

    // Parse body (may be empty for DELETE routes)
    let body: B = {} as B;
    try {
      const text = await request.text();
      if (text) body = JSON.parse(text) as B;
    } catch {
      // body is optional
    }

    const idempotencyKey = (body as Record<string, unknown>).idempotencyKey as string | undefined;

    // Get bearer token (already validated above) for Firestore client
    const idToken = extractBearerToken(request)!;
    const { firestore, cleanup } = await getFinanceUserFirestoreClient(idToken);

    try {
      // 2. Idempotency check
      if (idempotencyKey) {
        const existing = await getIdempotencyRecord(idempotencyKey, firestore);
        if (existing?.status === "succeeded") {
          return NextResponse.json({
            success: true,
            closing: existing.closingSnapshot,
            serverTime: existing.serverTime,
          });
        }
        if (existing?.status === "failed") {
          return NextResponse.json(
            { success: false, message: existing.message ?? "This operation previously failed." },
            { status: 400 },
          );
        }
      }

      // 3. Execute the service call
      let closing: FinanceDailyClosing;
      const serverTime = new Date().toISOString();
      try {
        closing = await handler({ uid, fullName, firestore, body });
      } catch (err) {
        // Write failed idempotency record so retries don't re-execute a definitively-failed operation
        if (idempotencyKey) {
          const failRecord: IdempotencyRecord = {
            status: "failed",
            message: err instanceof Error ? err.message : "Unknown error.",
            deviceTime: (body as Record<string, unknown>).deviceTime as string | undefined,
            serverTime,
            createdAt: serverTimestamp() as unknown as import("firebase/firestore").Timestamp,
          };
          await writeIdempotencyRecord(idempotencyKey, failRecord, firestore).catch(() => {});
        }
        throw err;
      }

      // 4. Write success idempotency record
      if (idempotencyKey) {
        const successRecord: IdempotencyRecord = {
          status: "succeeded",
          closingSnapshot: closing,
          deviceTime: (body as Record<string, unknown>).deviceTime as string | undefined,
          serverTime,
          createdAt: serverTimestamp() as unknown as import("firebase/firestore").Timestamp,
        };
        await writeIdempotencyRecord(idempotencyKey, successRecord, firestore).catch(() => {});
      }

      return NextResponse.json({ success: true, closing, serverTime });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, " [mobile mutation]");
  }
}
