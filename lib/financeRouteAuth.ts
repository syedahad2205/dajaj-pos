import { doc, getDoc, type Firestore } from "firebase/firestore";

class FinanceRouteForbiddenError extends Error {
  constructor(message = "This action requires an Admin account.") {
    super(message);
    this.name = "FinanceRouteForbiddenError";
  }
}

export function isFinanceRouteForbiddenError(error: unknown): error is FinanceRouteForbiddenError {
  return error instanceof FinanceRouteForbiddenError;
}

/**
 * A handful of Finance API routes must stay Admin-only even though a Finance
 * Manager's Firestore rules grant them write access to the same underlying
 * collection — e.g. a Finance Manager can write fin_accounts to post
 * transaction/closing balances, but must never create/edit/delete an account
 * outright; can write fin_daily_closing to run their own Daily Closing, but
 * must never reopen or backfill a day. Firestore rules alone can't express
 * that distinction (it's the same collection either way), so these specific
 * routes call this explicit check right after
 * getAuthenticatedFirestoreForRequest(), before touching any service
 * function, using the same per-request authenticated Firestore instance.
 */
export async function requireAdminCaller(firestore: Firestore, userId: string): Promise<void> {
  const snapshot = await getDoc(doc(firestore, "admins", userId));
  if (!snapshot.exists()) {
    throw new FinanceRouteForbiddenError();
  }
}
