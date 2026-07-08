import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin";
import { authenticateFinanceUser, type FinanceUserDataSource } from "@/services/financeUsersService";
import type { FinanceUser } from "@/lib/finance";

export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/v1/finance/auth/login
 *
 * Finance User login for the React Native mobile app. No Authorization
 * header is expected or required — the caller has no identity yet, only a
 * username/password pair. Credential verification is entirely delegated to
 * `authenticateFinanceUser()` (services/financeUsersService.ts) via an
 * Admin-SDK-backed FinanceUserDataSource, keeping all authentication
 * logic in one place per Requirement 1.2.
 *
 * WHY FinanceUserDataSource (not passing a Firestore instance directly):
 * The Firebase client SDK's modular functions (collection(), getDocs(),
 * writeBatch(), etc.) perform a runtime type-brand check and throw if
 * given a firebase-admin Firestore instance, even though the two SDKs
 * expose structurally similar APIs. Since this route has no caller
 * identity yet, it cannot use getAuthenticatedFirestoreForRequest().
 * The solution is FinanceUserDataSource — an interface that abstracts
 * exactly the two Firestore operations authenticateFinanceUser() needs,
 * with the Admin SDK supplying the implementation here and the client
 * SDK supplying the default everywhere else. See financeUsersService.ts
 * and design.md §5.1 (approved exception) for full rationale.
 *
 * Per Requirement 1.3, every authentication failure is HTTP 401 with
 * the thrown message. This route does NOT use financeErrorResponse(),
 * which would map most errors to 400.
 */

/** Admin-SDK-backed FinanceUserDataSource for the pre-authentication context. */
function makeAdminSdkDataSource(): FinanceUserDataSource {
  const adminDb = getAdminFirestore();

  return {
    async findByNormalizedUsername(normalizedUsername) {
      const snapshot = await adminDb
        .collection("finance_auth")
        .where("username", "==", normalizedUsername)
        .limit(1)
        .get();

      if (snapshot.empty) return null;

      const docSnap = snapshot.docs[0];
      const data = docSnap.data() as Omit<FinanceUser, "id">;
      return { id: docSnap.id, data: { id: docSnap.id, ...data } };
    },

    async recordLogin(userId, user) {
      const ref = adminDb.collection("finance_auth").doc(userId);
      const auditRef = adminDb.collection("fin_audit_logs").doc();

      const batch = adminDb.batch();
      batch.update(ref, { lastLogin: FieldValue.serverTimestamp() });
      batch.set(auditRef, {
        module: "finance_user",
        entityId: userId,
        entityLabel: `${user.fullName} (${user.username})`,
        action: "login",
        userId,
        userName: user.fullName,
        oldValue: null,
        newValue: null,
        reason: null,
        timestamp: FieldValue.serverTimestamp(),
      });
      await batch.commit();
    },
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { username?: string; password?: string };
    const { username, password } = body;

    // Pass the Admin-SDK data source — no client Firestore instance exists
    // yet (no caller identity), so the default client-SDK path cannot be used.
    const { user } = await authenticateFinanceUser(
      username ?? "",
      password ?? "",
      undefined, // db param unused when dataSource is provided
      makeAdminSdkDataSource(),
    );

    const customToken = await getAdminAuth().createCustomToken(user.id, {
      financeUser: true,
      active: true,
    });

    // `user` is already a FinanceUserPublic (no passwordHash) —
    // authenticateFinanceUser() calls toFinanceUserPublic() internally.
    return NextResponse.json({ success: true, customToken, user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid username or password.";
    return NextResponse.json({ success: false, message }, { status: 401 });
  }
}
