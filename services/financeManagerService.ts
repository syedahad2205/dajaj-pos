import { doc, getDoc } from "firebase/firestore";
import { firestore } from "@/lib/firebase";

// Finance Managers are a restricted role: real Firebase Auth accounts (same
// login mechanism as Admin, at /admin/login) that are scoped to only the
// Finance Dashboard, Daily Closing, Transactions, and Reports pages — never
// POS, Inventory, Riders, Zomato, Orders, Feedback, or Finance Settings.
//
// This is intentionally a completely separate collection/concept from
// `finance_auth` / `FinanceUser` (see lib/finance.ts) — that collection is
// for the (separate, not-yet-shipped) Daily Closing mobile app, uses
// username/bcrypt credentials with no Firebase Auth account of its own, and
// cannot access this web app at all. Do not conflate the two.
export interface FinanceManagerProfile {
  id: string;
  name: string;
  email: string;
  createdAt?: unknown;
  createdBy?: string;
  // Optional — a doc created manually via Firebase Console may not set this
  // field at all, and its absence must mean "active" (undefined !== false).
  // Set active: false to revoke access without deleting the record.
  active?: boolean;
}

function financeManagerDoc(userId: string) {
  return doc(firestore, "finance_managers", userId);
}

export async function getFinanceManagerProfile(userId: string): Promise<FinanceManagerProfile | null> {
  const snapshot = await getDoc(financeManagerDoc(userId));
  if (!snapshot.exists()) {
    return null;
  }

  return {
    id: snapshot.id,
    ...(snapshot.data() as Omit<FinanceManagerProfile, "id">),
  } satisfies FinanceManagerProfile;
}
