import { NextResponse } from "next/server";
import { isFirebaseRouteAuthError } from "@/lib/firebaseServerApp";

/**
 * Shared error → HTTP response mapping for every Finance module API route,
 * following the same convention as app/api/inventory/*: auth errors are
 * 401, Firestore permission-denied is 403, "not found" reads as 404,
 * everything else (including our own validation Errors, day-locked errors,
 * etc.) is a 400 with the thrown message surfaced directly — these are
 * meant to be shown to the manager entering the transaction.
 */
export function financeErrorResponse(error: unknown, context: string) {
  console.error(`[finance${context}]`, error);
  const message = error instanceof Error ? error.message : "Something went wrong.";
  const errorCode =
    typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";

  let status = 400;
  if (isFirebaseRouteAuthError(error)) status = 401;
  else if (errorCode === "permission-denied") status = 403;
  else if (/not found/i.test(message)) status = 404;
  else if (!(error instanceof Error)) status = 500;

  return NextResponse.json({ success: false, message }, { status });
}
