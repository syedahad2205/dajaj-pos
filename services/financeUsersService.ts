import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import bcrypt from "bcryptjs";
import { firestore as defaultFirestore } from "@/lib/firebase";
import { DEFAULT_BRANCH_ID, toFinanceUserPublic, type FinanceUser, type FinanceUserPublic } from "@/lib/finance";
import { writeFinanceAuditLog } from "@/services/financeAuditService";

// ─────────────────────────────────────────────────────────────────────────
// FinanceUserDataSource — abstraction over the two Firestore operations
// that authenticateFinanceUser() requires. The default implementation uses
// the Firebase client SDK (firebase/firestore), which is the right choice
// for all callers that already hold an authenticated client Firestore
// instance (web admin routes, existing tests).
//
// The mobile login API route (app/api/mobile/v1/finance/auth/login/route.ts)
// receives a *pre-authentication* request — no caller identity exists yet,
// so it cannot use getAuthenticatedFirestoreForRequest(). It must use the
// Firebase Admin SDK's Firestore API instead. Because the client SDK's
// modular functions (collection(), getDocs(), writeBatch(), etc.) perform
// a runtime type-brand check that rejects non-client-SDK Firestore
// instances, passing the Admin SDK object directly would throw. This
// interface lets the login route supply an Admin-SDK-backed implementation
// without changing any authentication behavior.
//
// APPROVED EXCEPTION (in addition to revokeTokens — see design.md §5.5):
// This refactor is the narrowly-scoped second exception to the
// "no changes to financeUsersService.ts" rule (Requirement 12.7). Only
// the Firestore access layer is abstracted. Authentication behavior
// (username normalization, bcrypt verify, active check, lastLogin update,
// audit logging) is unchanged and remains implemented exactly once.
// ─────────────────────────────────────────────────────────────────────────

export interface FinanceUserDataSource {
  /** Find a Finance User by exact normalized (lowercase) username, or null if not found. */
  findByNormalizedUsername(normalizedUsername: string): Promise<{ id: string; data: FinanceUser } | null>;
  /** Atomically record a successful login: update lastLogin and write the login audit log. */
  recordLogin(userId: string, user: FinanceUser): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────
// Finance Users — auth infrastructure for the future React Native Daily
// Closing app. Completely separate from Firebase Auth / /admins:
//   - No Firebase Auth account is ever created for a Finance User.
//   - Login is username + password, verified here against a bcrypt hash.
//   - The web admin UI (app/admin/finance/settings/users) manages these
//     records using the normal admin-authenticated Firestore access; the
//     mobile app will eventually call authenticateFinanceUser() through a
//     dedicated API route (not built yet — see task scope).
// Collection: finance_auth. Doc id is a generated Firestore id, NOT the
// username (usernames can be renamed... though not exposed in the UI
// today, keeping id independent avoids ever needing a document rename).
// ─────────────────────────────────────────────────────────────────────────

const BCRYPT_SALT_ROUNDS = 10;

function financeUsersCollection(db: Firestore) {
  return collection(db, "finance_auth");
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

async function findByUsername(username: string, db: Firestore): Promise<{ id: string; data: FinanceUser } | null> {
  const snapshot = await getDocs(query(financeUsersCollection(db), where("username", "==", normalizeUsername(username))));
  if (snapshot.empty) return null;
  const docSnap = snapshot.docs[0];
  return { id: docSnap.id, data: { id: docSnap.id, ...(docSnap.data() as Omit<FinanceUser, "id">) } };
}

/**
 * Default FinanceUserDataSource implementation backed by the Firebase client
 * SDK. Used by every caller that already holds an authenticated client
 * Firestore instance — web admin routes, existing tests, and any future
 * server-side caller that has a per-request Firestore client.
 */
function makeClientSdkDataSource(db: Firestore): FinanceUserDataSource {
  return {
    async findByNormalizedUsername(normalizedUsername) {
      return findByUsername(normalizedUsername, db);
    },
    async recordLogin(userId, user) {
      const ref = doc(financeUsersCollection(db), userId);
      const batch = writeBatch(db);
      batch.update(ref, { lastLogin: serverTimestamp() });
      writeFinanceAuditLog(batch, db, {
        module: "finance_user",
        entityId: userId,
        entityLabel: `${user.fullName} (${user.username})`,
        action: "login",
        userId,
        userName: user.fullName,
      });
      await batch.commit();
    },
  };
}

export async function getFinanceUsers(
  options: { branchId?: string } = {},
  db: Firestore = defaultFirestore,
): Promise<FinanceUserPublic[]> {
  const branchId = options.branchId ?? DEFAULT_BRANCH_ID;
  const snapshot = await getDocs(query(financeUsersCollection(db), where("branchId", "==", branchId), orderBy("fullName", "asc")));
  return snapshot.docs.map((d) => toFinanceUserPublic({ id: d.id, ...(d.data() as Omit<FinanceUser, "id">) }));
}

export async function getFinanceUser(userId: string, db: Firestore = defaultFirestore): Promise<FinanceUserPublic | null> {
  const snap = await getDoc(doc(financeUsersCollection(db), userId));
  if (!snap.exists()) return null;
  return toFinanceUserPublic({ id: snap.id, ...(snap.data() as Omit<FinanceUser, "id">) });
}

export interface CreateFinanceUserInput {
  fullName: string;
  username: string;
  password: string;
  branchId?: string;
}

export async function createFinanceUser(
  input: CreateFinanceUserInput,
  createdByUserId: string,
  createdByName: string,
  db: Firestore = defaultFirestore,
): Promise<FinanceUserPublic> {
  const fullName = input.fullName.trim();
  const username = normalizeUsername(input.username);
  const branchId = input.branchId ?? DEFAULT_BRANCH_ID;

  if (!fullName) throw new Error("Full name is required.");
  if (!username) throw new Error("Username is required.");
  if (!/^[a-z0-9._-]+$/.test(username)) {
    throw new Error("Username may only contain lowercase letters, numbers, dots, underscores, and hyphens.");
  }
  if (!input.password || input.password.length < 6) throw new Error("Password must be at least 6 characters.");

  const existing = await findByUsername(username, db);
  if (existing) throw new Error(`Username "${username}" is already taken.`);

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_SALT_ROUNDS);

  const batch = writeBatch(db);
  const ref = doc(financeUsersCollection(db));
  const data = {
    fullName,
    username,
    passwordHash,
    active: true,
    role: "finance_user" as const,
    lastLogin: null,
    createdBy: createdByUserId,
    createdByName,
    branchId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  batch.set(ref, data);
  writeFinanceAuditLog(batch, db, {
    module: "finance_user",
    entityId: ref.id,
    entityLabel: `${fullName} (${username})`,
    action: "create",
    userId: createdByUserId,
    userName: createdByName,
    newValue: { fullName, username, active: true, role: "finance_user" },
  });
  await batch.commit();

  return toFinanceUserPublic({ id: ref.id, ...data } as unknown as FinanceUser);
}

export interface UpdateFinanceUserInput {
  fullName?: string;
  username?: string;
  active?: boolean;
}

export async function updateFinanceUser(
  userId: string,
  input: UpdateFinanceUserInput,
  actorUserId: string,
  actorName: string,
  db: Firestore = defaultFirestore,
): Promise<void> {
  const ref = doc(financeUsersCollection(db), userId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Finance user not found.");
  const before = snap.data() as Omit<FinanceUser, "id">;

  const updates: Record<string, unknown> = { updatedAt: serverTimestamp() };

  if (input.fullName !== undefined) {
    const fullName = input.fullName.trim();
    if (!fullName) throw new Error("Full name is required.");
    updates.fullName = fullName;
  }

  if (input.username !== undefined) {
    const username = normalizeUsername(input.username);
    if (!username) throw new Error("Username is required.");
    if (!/^[a-z0-9._-]+$/.test(username)) {
      throw new Error("Username may only contain lowercase letters, numbers, dots, underscores, and hyphens.");
    }
    if (username !== before.username) {
      const existing = await findByUsername(username, db);
      if (existing && existing.id !== userId) throw new Error(`Username "${username}" is already taken.`);
      updates.username = username;
    }
  }

  if (input.active !== undefined) updates.active = input.active;

  const batch = writeBatch(db);
  batch.update(ref, updates);
  writeFinanceAuditLog(batch, db, {
    module: "finance_user",
    entityId: userId,
    entityLabel: `${(input.fullName ?? before.fullName) as string} (${(updates.username ?? before.username) as string})`,
    action: input.active === false ? "disable" : input.active === true ? "enable" : "update",
    userId: actorUserId,
    userName: actorName,
    oldValue: { fullName: before.fullName, username: before.username, active: before.active },
    newValue: updates,
  });
  await batch.commit();
}

/**
 * Replaces a Finance User's password hash. Per spec, changing the password
 * must immediately invalidate any previous session — once real mobile
 * sessions exist, that invalidation should be keyed off `updatedAt` (or a
 * dedicated `passwordChangedAt` field) so issued tokens can be checked
 * against it. Session issuance itself is out of scope for this task.
 */
export async function changeFinancePassword(
  userId: string,
  newPassword: string,
  actorUserId: string,
  actorName: string,
  db: Firestore = defaultFirestore,
  revokeTokens: (userId: string) => Promise<void> = async () => {},
): Promise<void> {
  const ref = doc(financeUsersCollection(db), userId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Finance user not found.");
  const before = snap.data() as Omit<FinanceUser, "id">;

  if (!newPassword || newPassword.length < 6) throw new Error("Password must be at least 6 characters.");

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);

  const batch = writeBatch(db);
  batch.update(ref, { passwordHash, updatedAt: serverTimestamp() });
  writeFinanceAuditLog(batch, db, {
    module: "finance_user",
    entityId: userId,
    entityLabel: `${before.fullName} (${before.username})`,
    action: "password_change",
    userId: actorUserId,
    userName: actorName,
  });
  await batch.commit();
  await revokeTokens(userId);
}

export async function disableFinanceUser(
  userId: string,
  actorUserId: string,
  actorName: string,
  db: Firestore = defaultFirestore,
  revokeTokens: (userId: string) => Promise<void> = async () => {},
): Promise<void> {
  await updateFinanceUser(userId, { active: false }, actorUserId, actorName, db);
  await revokeTokens(userId);
}

export async function enableFinanceUser(
  userId: string,
  actorUserId: string,
  actorName: string,
  db: Firestore = defaultFirestore,
): Promise<void> {
  await updateFinanceUser(userId, { active: true }, actorUserId, actorName, db);
}

export async function deleteFinanceUser(
  userId: string,
  actorUserId: string,
  actorName: string,
  db: Firestore = defaultFirestore,
): Promise<void> {
  const ref = doc(financeUsersCollection(db), userId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Finance user not found.");
  const data = snap.data() as Omit<FinanceUser, "id">;

  const batch = writeBatch(db);
  batch.delete(ref);
  writeFinanceAuditLog(batch, db, {
    module: "finance_user",
    entityId: userId,
    entityLabel: `${data.fullName} (${data.username})`,
    action: "delete",
    userId: actorUserId,
    userName: actorName,
    oldValue: { fullName: data.fullName, username: data.username },
  });
  await batch.commit();
}

export interface AuthenticateFinanceUserResult {
  user: FinanceUserPublic;
}

/**
 * Verifies username + password for a Finance User. This is the one
 * function the mobile app's login route ultimately calls —
 * everything else in this service exists to support the admin management
 * UI. Deliberately framework-agnostic (no session/JWT issuance here) so
 * whatever session strategy the mobile app ends up using can wrap this
 * without requiring changes to the check itself.
 *
 * Throws a generic "Invalid username or password." for both "no such
 * user" and "wrong password" so a login API never reveals which part was
 * wrong (standard practice — avoids username enumeration).
 *
 * The optional `dataSource` parameter accepts a FinanceUserDataSource
 * implementation. The default uses the Firebase client SDK (correct for
 * all callers with an existing authenticated Firestore instance). The
 * mobile login API route passes an Admin-SDK-backed implementation because
 * no caller identity exists at pre-authentication time — see the
 * FinanceUserDataSource interface comment for the full rationale.
 */
export async function authenticateFinanceUser(
  username: string,
  password: string,
  db: Firestore = defaultFirestore,
  dataSource?: FinanceUserDataSource,
): Promise<AuthenticateFinanceUserResult> {
  const source = dataSource ?? makeClientSdkDataSource(db);
  const normalized = normalizeUsername(username || "");
  if (!normalized || !password) throw new Error("Invalid username or password.");

  const found = await source.findByNormalizedUsername(normalized);
  if (!found) throw new Error("Invalid username or password.");

  const { id, data: user } = found;
  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) throw new Error("Invalid username or password.");

  if (!user.active) throw new Error("This account has been disabled. Contact your administrator.");

  await source.recordLogin(id, user);

  return { user: toFinanceUserPublic({ ...user, id }) };
}
