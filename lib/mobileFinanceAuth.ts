import { NextResponse } from "next/server";
import { deleteApp, initializeServerApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

/** Roles allowed to use the mobile Daily Closing app — mirrors the web gate. */
export type MobileFinanceRole = "admin" | "financeManager";

/**
 * Result type for verifyFinanceAccessRequest().
 * Routes pattern-match on `ok`:
 *   if (!result.ok) return result.response;
 *   const { uid, fullName } = result;
 */
export type VerifyResult =
  | { ok: true; uid: string; fullName: string; role: MobileFinanceRole; email: string | null }
  | { ok: false; response: NextResponse };

/**
 * Resolves the caller's finance identity from a verified ID token.
 *
 * Checks, in order:
 * 1. admins/{uid} exists                      → role "admin"
 * 2. finance_managers/{uid} exists and active → role "financeManager"
 *    (absence of `active` counts as active, matching isFinanceManager()
 *    in firestore.rules which uses .get('active', true))
 *
 * This mirrors isAdminOrFinanceManager() in the Firestore rules as
 * defense-in-depth at the API route layer. Both must be kept in sync if
 * the activation model ever changes.
 */
export async function resolveFinanceIdentity(uid: string): Promise<{
  role: MobileFinanceRole;
  fullName: string;
} | null> {
  const db = getAdminFirestore();

  const adminSnap = await db.collection("admins").doc(uid).get();
  if (adminSnap.exists) {
    const data = adminSnap.data() as { name?: string; fullName?: string } | undefined;
    return { role: "admin", fullName: data?.name ?? data?.fullName ?? "Admin" };
  }

  const managerSnap = await db.collection("finance_managers").doc(uid).get();
  if (managerSnap.exists) {
    const data = managerSnap.data() as { active?: boolean; name?: string; fullName?: string } | undefined;
    // Absence of `active` means active — same convention as the rules
    if (data?.active !== false) {
      return { role: "financeManager", fullName: data?.name ?? data?.fullName ?? "Finance Manager" };
    }
  }

  return null;
}

/**
 * Shared identity-verification helper for every mobile route under
 * /api/mobile/v1/finance/...
 *
 * Checks, in order:
 * 1. Authorization: Bearer <idToken> header is present.
 * 2. The ID token is valid (via Admin SDK verifyIdToken).
 * 3. The uid resolves to an admin or an active finance manager.
 */
export async function verifyFinanceAccessRequest(request: Request): Promise<VerifyResult> {
  // 1. Extract bearer token
  const authorization =
    request.headers.get("authorization") ??
    request.headers.get("Authorization") ??
    request.headers.get("x-auth-token") ??
    request.headers.get("X-Auth-Token");

  if (!authorization?.startsWith("Bearer ")) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, message: "Unauthorized: No Bearer token" },
        { status: 401 },
      ),
    };
  }
  const idToken = authorization.slice("Bearer ".length).trim();
  if (!idToken) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, message: "Unauthorized: Empty token" },
        { status: 401 },
      ),
    };
  }

  // 2. Verify token
  let decodedToken: Awaited<ReturnType<ReturnType<typeof getAdminAuth>["verifyIdToken"]>>;
  try {
    decodedToken = await getAdminAuth().verifyIdToken(idToken);
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, message: "Unauthorized: Token verification failed" },
        { status: 401 },
      ),
    };
  }

  // 3. Resolve role — admin or active finance manager only
  try {
    const identity = await resolveFinanceIdentity(decodedToken.uid);
    if (!identity) {
      return {
        ok: false,
        response: NextResponse.json(
          { success: false, message: "Forbidden: This account does not have finance access." },
          { status: 403 },
        ),
      };
    }
    return { ok: true, uid: decodedToken.uid, fullName: identity.fullName, role: identity.role, email: decodedToken.email ?? null };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, message: "Forbidden: Could not verify finance access." },
        { status: 403 },
      ),
    };
  }
}

/**
 * Extracts the bearer token from an Authorization header without verifying it.
 * Call only after verifyFinanceAccessRequest() has already validated the token.
 */
export function extractBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim() || null;
}

/**
 * Creates a per-request caller-identity Firestore client from an
 * already-extracted ID token. Mirrors the
 * `getAuthenticatedFirestoreForRequest` pattern in lib/firebaseServerApp.ts
 * but accepts an already-extracted idToken (since mobile routes call
 * verifyFinanceAccessRequest first, then build the Firestore client separately).
 *
 * Always call cleanup() in a finally block to avoid leaking serverApp instances.
 */
export async function getFinanceUserFirestoreClient(idToken: string): Promise<{
  firestore: Firestore;
  cleanup: () => Promise<void>;
}> {
  const serverApp = initializeServerApp(firebaseConfig, { authIdToken: idToken });
  const auth = getAuth(serverApp);

  // Token-based server apps often hydrate the user synchronously; avoid
  // waiting on a listener in that case.
  await Promise.resolve();
  if (!auth.currentUser) {
    const ready = (auth as { authStateReady?: () => Promise<void> }).authStateReady;
    if (typeof ready === "function") {
      // Resolves once the initial auth state (from the injected ID token)
      // is fully loaded — proceeding earlier risks running unauthenticated.
      await ready.call(auth);
    } else {
      await new Promise<void>((resolve) => {
        const unsubscribe = getAuth(serverApp).onAuthStateChanged((user) => {
          if (!user) return; // keep waiting until the token hydrates
          unsubscribe();
          resolve();
        });
      });
    }
  }

  if (!auth.currentUser) {
    await cleanupApp(serverApp);
    throw new Error("Identity forwarding failed: no authenticated user for the supplied ID token.");
  }

  return {
    firestore: getFirestore(serverApp),
    cleanup: () => cleanupApp(serverApp),
  };
}

async function cleanupApp(serverApp: ReturnType<typeof initializeServerApp>): Promise<void> {
  try {
    await deleteApp(serverApp);
  } catch {
    // app may already be deleted — nothing to do
  }
}
