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

/**
 * Result type for verifyFinanceUserRequest().
 * Routes pattern-match on `ok`:
 *   if (!result.ok) return result.response;
 *   const { uid, fullName } = result;
 */
export type VerifyResult =
  | { ok: true; uid: string; fullName: string }
  | { ok: false; response: NextResponse };

/**
 * Shared identity-verification helper for every mobile mutation route under
 * /api/mobile/v1/finance/closing/...
 *
 * Checks, in order:
 * 1. Authorization: Bearer <idToken> header is present.
 * 2. The ID token is valid (via Admin SDK verifyIdToken).
 * 3. The token carries `financeUser: true` custom claim.
 * 4. The corresponding finance_auth/{uid} document exists and has active == true.
 *
 * This mirrors the `isFinanceUser()` Firestore Rules check (Requirement 3.1)
 * as defense-in-depth at the API route layer (Requirement 4.2). Both checks
 * must be kept in sync if the activation model ever changes.
 *
 * Returns { ok: true, uid, fullName } on success.
 * Returns { ok: false, response } on any failure — the route should early-return response.
 */
export async function verifyFinanceUserRequest(request: Request): Promise<VerifyResult> {
  console.log('[mobileFinanceAuth] ═══════════════════════════════════════════════');
  console.log('[mobileFinanceAuth] Starting verifyFinanceUserRequest');
  console.log('[mobileFinanceAuth] Request URL:', request.url);
  console.log('[mobileFinanceAuth] Request method:', request.method);
  
  // 1. Extract bearer token
  const authorization = request.headers.get("authorization") ?? request.headers.get("Authorization");
  console.log('[mobileFinanceAuth] Authorization header present:', !!authorization);
  console.log('[mobileFinanceAuth] Authorization header starts with Bearer:', authorization?.startsWith("Bearer "));
  
  if (!authorization?.startsWith("Bearer ")) {
    console.error('[mobileFinanceAuth] ❌ No Bearer token in Authorization header');
    return {
      ok: false,
      response: NextResponse.json({ 
        success: false, 
        message: "Unauthorized: No Bearer token",
        debug: {
          hasAuthHeader: !!authorization,
          authHeaderPreview: authorization?.substring(0, 20),
        }
      }, { status: 401 }),
    };
  }
  const idToken = authorization.slice("Bearer ".length).trim();
  if (!idToken) {
    console.error('[mobileFinanceAuth] ❌ Empty token after Bearer prefix');
    return {
      ok: false,
      response: NextResponse.json({ 
        success: false, 
        message: "Unauthorized: Empty token" 
      }, { status: 401 }),
    };
  }
  
  console.log('[mobileFinanceAuth] ✓ Token extracted, length:', idToken.length);

  // 2 + 3. Verify token and check financeUser claim
  let decodedToken: Awaited<ReturnType<ReturnType<typeof getAdminAuth>["verifyIdToken"]>>;
  try {
    console.log('[mobileFinanceAuth] Calling getAdminAuth()...');
    const adminAuth = getAdminAuth();
    console.log('[mobileFinanceAuth] ✓ Admin Auth obtained');
    
    console.log('[mobileFinanceAuth] Verifying ID token...');
    decodedToken = await adminAuth.verifyIdToken(idToken);
    
    console.log('[mobileFinanceAuth] ✓ Token verified successfully');
    console.log('[mobileFinanceAuth] UID:', decodedToken.uid);
    console.log('[mobileFinanceAuth] Type of decodedToken:', typeof decodedToken);
    console.log('[mobileFinanceAuth] decodedToken keys:', Object.keys(decodedToken));
    console.log('[mobileFinanceAuth] financeUser claim (direct):', decodedToken.financeUser);
    console.log('[mobileFinanceAuth] financeUser claim (bracket):', (decodedToken as any)['financeUser']);
    console.log('[mobileFinanceAuth] All custom claims:', JSON.stringify({
      financeUser: decodedToken.financeUser,
      active: (decodedToken as any).active,
      email: decodedToken.email,
      email_verified: decodedToken.email_verified,
    }));
  } catch (error) {
    console.error('[mobileFinanceAuth] ❌ Token verification failed');
    console.error('[mobileFinanceAuth] Error type:', error?.constructor?.name);
    console.error('[mobileFinanceAuth] Error message:', error instanceof Error ? error.message : String(error));
    console.error('[mobileFinanceAuth] Error stack:', error instanceof Error ? error.stack : 'N/A');
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      ok: false,
      response: NextResponse.json({ 
        success: false, 
        message: "Unauthorized: Token verification failed",
        debug: {
          error: errorMessage,
          errorType: error?.constructor?.name || 'Unknown',
          tokenPreview: idToken.substring(0, 50) + '...',
        }
      }, { status: 401 }),
    };
  }

  console.log('[mobileFinanceAuth] Checking financeUser claim...');
  if (!decodedToken.financeUser && !(decodedToken as any)['financeUser']) {
    console.error('[mobileFinanceAuth] Token missing financeUser claim');
    console.error('[mobileFinanceAuth] Full decoded token:', JSON.stringify(decodedToken, null, 2));
    
    // Return detailed error for debugging
    return {
      ok: false,
      response: NextResponse.json({ 
        success: false, 
        message: "Unauthorized: financeUser claim missing",
        debug: {
          hasFinanceUserDirect: !!decodedToken.financeUser,
          hasFinanceUserBracket: !!(decodedToken as any)['financeUser'],
          tokenKeys: Object.keys(decodedToken),
          uid: decodedToken.uid,
        }
      }, { status: 401 }),
    };
  }

  console.log('[mobileFinanceAuth] financeUser claim verified');

  // 4. Confirm finance_auth/{uid} exists and is active (defense-in-depth: rules check this too)
  const uid = decodedToken.uid;
  let fullName: string;
  try {
    const adminDb = getAdminFirestore();
    const snap = await adminDb.collection("finance_auth").doc(uid).get();
    if (!snap.exists) {
      return {
        ok: false,
        response: NextResponse.json(
          { success: false, message: "Finance User account is inactive or not found." },
          { status: 403 },
        ),
      };
    }
    const data = snap.data() as { active?: boolean; fullName?: string };
    if (!data.active) {
      return {
        ok: false,
        response: NextResponse.json(
          { success: false, message: "Finance User account is inactive or not found." },
          { status: 403 },
        ),
      };
    }
    fullName = data.fullName ?? "";
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, message: "Finance User account is inactive or not found." },
        { status: 403 },
      ),
    };
  }

  return { ok: true, uid, fullName };
}

/**
 * Extracts the bearer token from an Authorization header without verifying it.
 * Call only after verifyFinanceUserRequest() has already validated the token.
 */
export function extractBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim() || null;
}

/**
 * Creates a per-request Finance-User-identity Firestore client from an
 * already-extracted Finance User ID token. Mirrors the
 * `getAuthenticatedFirestoreForRequest` pattern in lib/firebaseServerApp.ts
 * but accepts an already-extracted idToken (since mobile routes call
 * verifyFinanceUserRequest first, then build the Firestore client separately).
 *
 * Always call cleanup() in a finally block to avoid leaking serverApp instances.
 */
export async function getFinanceUserFirestoreClient(idToken: string): Promise<{
  firestore: Firestore;
  cleanup: () => Promise<void>;
}> {
  const serverApp = initializeServerApp(firebaseConfig, { authIdToken: idToken });
  // Auth state is needed so the Firestore SDK recognizes the session.
  await new Promise<void>((resolve) => {
    const unsubscribe = getAuth(serverApp).onAuthStateChanged(() => {
      unsubscribe();
      resolve();
    });
  });
  return {
    firestore: getFirestore(serverApp),
    cleanup: () => deleteApp(serverApp),
  };
}
