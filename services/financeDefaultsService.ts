import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { firestore as defaultFirestore } from "@/lib/firebase";
import {
  BUILT_IN_FINANCE_DEFAULT_EVENTS,
  CASH_DEPOSIT_TYPE_LABELS,
  DEFAULT_BRANCH_ID,
  SUPPORTED_CASH_DEPOSIT_TYPES,
  depositEventKey,
  generateLocalId,
  type FinanceDefault,
} from "@/lib/finance";
import { logFinanceAudit, writeFinanceAuditLog } from "@/services/financeAuditService";
import { getFinanceAccount } from "@/services/financeAccountsService";

// ─────────────────────────────────────────────────────────────────────────
// Finance Defaults — the single place a business event (Cash Sales, UPI
// Sales, a Pigmi Deposit, ...) is mapped to the account it posts into.
// Accounts stay pure "where money is stored"; Daily Closing stays pure
// "what happened today"; this is the only place business rules live.
// Collection name intentionally left as `finance_defaults` (no fin_
// prefix) to match how it was specified.
// ─────────────────────────────────────────────────────────────────────────

function financeDefaultsCollection(db: Firestore) {
  return collection(db, "finance_defaults");
}

function slugifyEventKey(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || generateLocalId();
}

/**
 * Cash Deposit events (Pigmi Deposit, etc.) auto-post as a Transfer FROM
 * whichever account "Cash Sales" maps to TO their own mapped account —
 * see postDailyClosingToLedger in financeClosingService.ts. A transfer
 * needs two different accounts, so saving either side to the same account
 * as the other would create a mapping that can never actually post
 * (silently, since the auto-posting code just skips it with a warning).
 * Catch that at save time instead, with an error that explains why.
 */
async function assertNoCashDrawerConflict(
  db: Firestore,
  branchId: string,
  eventKey: string,
  destinationAccountId: string,
): Promise<void> {
  const isDepositEvent = eventKey.endsWith("_deposit");
  const isCashSales = eventKey === "cash_sales";
  if (!isDepositEvent && !isCashSales) return;

  if (isCashSales) {
    const rows = await getFinanceDefaults({ includeInactive: true, branchId }, db);
    const conflict = rows.find((r) => r.eventKey.endsWith("_deposit") && r.destinationAccountId === destinationAccountId);
    if (conflict) {
      throw new Error(
        `"${conflict.eventName}" is already mapped to this account. Cash Deposits transfer FROM the Cash Sales account TO their own account, so the two can't be the same — pick a different account for one of them.`,
      );
    }
  } else {
    const cashSalesSnap = await getDoc(doc(financeDefaultsCollection(db), "cash_sales"));
    if (cashSalesSnap.exists() && cashSalesSnap.data().destinationAccountId === destinationAccountId) {
      throw new Error(
        `Cash Sales is already mapped to this account. Cash Deposits transfer FROM the Cash Sales account TO their own account, so the two can't be the same — pick a different account, or change Cash Sales first.`,
      );
    }
  }
}

const LEGACY_SETTLEMENT_EVENT_MIGRATIONS: Array<{ oldKey: string; newKey: string; newEventName: string; newDescription: string }> = [
  {
    oldKey: "zomato_settlement",
    newKey: "zomato_settlement_received",
    newEventName: "Zomato Settlement Received",
    newDescription:
      "The actual bank credit when a Zomato payout settles. Posted automatically by the Zomato module's settlement reconciliation — never by Daily Closing.",
  },
  {
    oldKey: "swiggy_settlement",
    newKey: "swiggy_settlement_received",
    newEventName: "Swiggy Settlement Received",
    newDescription: "The actual bank credit when a Swiggy payout settles. Posted by a future Swiggy settlement reconciliation, once that module exists.",
  },
];

/**
 * One-time, idempotent migration: Zomato/Swiggy Sales used to post straight
 * to a bank account under the keys "zomato_settlement"/"swiggy_settlement".
 * Now Daily Closing posts revenue into an Escrow account under
 * "zomato_sales"/"swiggy_sales", and the old keys are repurposed for the
 * *actual* bank credit posted by settlement reconciliation instead. Carries
 * the old row's destinationAccountId/isActive over to the new key (same
 * bank account is still correct — it's the "received" side now) and
 * removes the old row. No-ops once already migrated, and no-ops if the
 * legacy row was never created in the first place.
 */
export async function migrateLegacySettlementDefaults(
  userId: string,
  userName: string,
  db: Firestore = defaultFirestore,
  branchId: string = DEFAULT_BRANCH_ID,
): Promise<void> {
  for (const m of LEGACY_SETTLEMENT_EVENT_MIGRATIONS) {
    const oldRef = doc(financeDefaultsCollection(db), m.oldKey);
    const newRef = doc(financeDefaultsCollection(db), m.newKey);
    // eslint-disable-next-line no-await-in-loop
    const [oldSnap, newSnap] = await Promise.all([getDoc(oldRef), getDoc(newRef)]);
    if (!oldSnap.exists() || newSnap.exists()) continue;

    const old = oldSnap.data();
    const newData: Omit<FinanceDefault, "id"> = {
      eventKey: m.newKey,
      eventName: m.newEventName,
      destinationAccountId: (old.destinationAccountId as string | null) ?? null,
      destinationAccountName: (old.destinationAccountName as string | null) ?? null,
      description: m.newDescription,
      isActive: (old.isActive as boolean) ?? true,
      displayOrder: (old.displayOrder as number) ?? 0,
      branchId,
      createdAt: serverTimestamp() as never,
      updatedAt: serverTimestamp() as never,
    };

    const batch = writeBatch(db);
    batch.set(newRef, newData);
    batch.delete(oldRef);
    writeFinanceAuditLog(batch, db, {
      module: "finance_default",
      entityId: m.newKey,
      entityLabel: m.newEventName,
      action: "create",
      userId,
      userName,
      oldValue: old,
      newValue: newData,
      reason: `Auto-migrated from legacy "${m.oldKey}" — Zomato/Swiggy Sales now post to Escrow; this event represents the actual bank settlement instead.`,
    });
    // eslint-disable-next-line no-await-in-loop
    await batch.commit();
  }
}

export async function getFinanceDefaults(
  options: { includeInactive?: boolean; branchId?: string } = {},
  db: Firestore = defaultFirestore,
): Promise<FinanceDefault[]> {
  const branchId = options.branchId ?? DEFAULT_BRANCH_ID;
  const snapshot = await getDocs(
    query(financeDefaultsCollection(db), where("branchId", "==", branchId), orderBy("displayOrder", "asc")),
  );
  const rows = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FinanceDefault, "id">) }));
  return options.includeInactive ? rows : rows.filter((r) => r.isActive);
}

/** All Finance Defaults (active and inactive) as a lookup map keyed by eventKey — used by the auto-posting logic, which decides for itself whether an inactive/missing mapping should skip. */
export async function getFinanceDefaultsMap(
  db: Firestore = defaultFirestore,
  branchId: string = DEFAULT_BRANCH_ID,
): Promise<Map<string, FinanceDefault>> {
  const rows = await getFinanceDefaults({ includeInactive: true, branchId }, db);
  return new Map(rows.map((r) => [r.eventKey, r]));
}

export interface UpsertFinanceDefaultInput {
  eventName: string;
  destinationAccountId?: string | null;
  description?: string;
  branchId?: string;
}

/** Creates a new custom event mapping (e.g. "Amazon Pay" → Canara). Built-in events are created via seedDefaultFinanceDefaults instead. */
export async function createFinanceDefault(
  input: UpsertFinanceDefaultInput,
  userId: string,
  userName: string,
  db: Firestore = defaultFirestore,
): Promise<FinanceDefault> {
  const eventName = input.eventName.trim();
  if (!eventName) throw new Error("Event name is required.");
  const branchId = input.branchId ?? DEFAULT_BRANCH_ID;
  const eventKey = slugifyEventKey(eventName);

  const ref = doc(financeDefaultsCollection(db), eventKey);
  const existing = await getDoc(ref);
  if (existing.exists()) throw new Error(`An event named "${eventName}" already exists.`);

  const destinationAccount = input.destinationAccountId ? await getFinanceAccount(input.destinationAccountId, db) : null;
  if (destinationAccount) {
    await assertNoCashDrawerConflict(db, branchId, eventKey, destinationAccount.id);
  }
  const existingCount = (await getDocs(query(financeDefaultsCollection(db), where("branchId", "==", branchId)))).size;

  const batch = writeBatch(db);
  const data: Omit<FinanceDefault, "id"> = {
    eventKey,
    eventName,
    destinationAccountId: destinationAccount?.id ?? null,
    destinationAccountName: destinationAccount?.name ?? null,
    description: input.description?.trim() ?? "",
    isActive: true,
    displayOrder: existingCount,
    branchId,
    createdAt: serverTimestamp() as never,
    updatedAt: serverTimestamp() as never,
  };
  batch.set(ref, data);
  writeFinanceAuditLog(batch, db, {
    module: "finance_default",
    entityId: eventKey,
    entityLabel: eventName,
    action: "create",
    userId,
    userName,
    newValue: data,
  });
  await batch.commit();

  return { id: eventKey, ...data };
}

export interface UpdateFinanceDefaultInput {
  eventName?: string;
  destinationAccountId?: string | null;
  description?: string;
  isActive?: boolean;
  displayOrder?: number;
}

export async function updateFinanceDefault(
  eventKey: string,
  input: UpdateFinanceDefaultInput,
  userId: string,
  userName: string,
  db: Firestore = defaultFirestore,
): Promise<void> {
  const ref = doc(financeDefaultsCollection(db), eventKey);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Finance Default not found.");
  const before = snap.data();

  const updates: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (input.eventName !== undefined) updates.eventName = input.eventName.trim();
  if (input.description !== undefined) updates.description = input.description.trim();
  if (input.isActive !== undefined) updates.isActive = input.isActive;
  if (input.displayOrder !== undefined) updates.displayOrder = input.displayOrder;
  if (input.destinationAccountId !== undefined) {
    if (input.destinationAccountId) {
      const account = await getFinanceAccount(input.destinationAccountId, db);
      if (!account) throw new Error("Selected account no longer exists.");
      await assertNoCashDrawerConflict(db, before.branchId as string, eventKey, account.id);
      updates.destinationAccountId = account.id;
      updates.destinationAccountName = account.name;
    } else {
      updates.destinationAccountId = null;
      updates.destinationAccountName = null;
    }
  }

  const batch = writeBatch(db);
  batch.update(ref, updates);
  writeFinanceAuditLog(batch, db, {
    module: "finance_default",
    entityId: eventKey,
    entityLabel: (input.eventName ?? before.eventName) as string,
    action: input.isActive === false ? "archive" : input.isActive === true ? "restore" : "update",
    userId,
    userName,
    oldValue: before,
    newValue: updates,
  });
  await batch.commit();
}

export async function deleteFinanceDefault(eventKey: string, userId: string, userName: string, db: Firestore = defaultFirestore): Promise<void> {
  const ref = doc(financeDefaultsCollection(db), eventKey);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Finance Default not found.");
  const data = snap.data();

  const batch = writeBatch(db);
  batch.delete(ref);
  writeFinanceAuditLog(batch, db, {
    module: "finance_default",
    entityId: eventKey,
    entityLabel: data.eventName as string,
    action: "delete",
    userId,
    userName,
    oldValue: data,
  });
  await batch.commit();
}

/** Seeds the built-in event rows (Cash Sales, UPI Sales, Zomato/Swiggy Sales, Other Income, Zomato/Swiggy Settlement Received, and one per supported Cash Deposit type) with no destination configured yet. Safe to call repeatedly — skips events that already exist. */
export async function seedDefaultFinanceDefaults(
  userId: string,
  userName: string,
  db: Firestore = defaultFirestore,
  branchId: string = DEFAULT_BRANCH_ID,
): Promise<number> {
  const events = [
    ...BUILT_IN_FINANCE_DEFAULT_EVENTS,
    ...SUPPORTED_CASH_DEPOSIT_TYPES.map((type) => ({
      eventKey: depositEventKey(type),
      eventName: `${CASH_DEPOSIT_TYPE_LABELS[type]} Deposit`,
      description: `Daily Closing's ${CASH_DEPOSIT_TYPE_LABELS[type]} Deposit total — posted as a Transfer out of the Cash Sales destination account.`,
    })),
  ];

  const existing = await getDocs(query(financeDefaultsCollection(db), where("branchId", "==", branchId)));
  const existingKeys = new Set(existing.docs.map((d) => d.id));

  let created = 0;
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    if (existingKeys.has(event.eventKey)) continue;

    const ref = doc(financeDefaultsCollection(db), event.eventKey);
    const data: Omit<FinanceDefault, "id"> = {
      eventKey: event.eventKey,
      eventName: event.eventName,
      destinationAccountId: null,
      destinationAccountName: null,
      description: event.description,
      isActive: true,
      displayOrder: existingKeys.size + created,
      branchId,
      createdAt: serverTimestamp() as never,
      updatedAt: serverTimestamp() as never,
    };
    await setDoc(ref, data);
    await logFinanceAudit(
      { module: "finance_default", entityId: event.eventKey, entityLabel: event.eventName, action: "create", userId, userName, newValue: data },
      db,
    );
    created += 1;
  }

  return created;
}
