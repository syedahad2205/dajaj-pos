import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { firestore as defaultFirestore } from "@/lib/firebase";
import { DEFAULT_BRANCH_ID, type FinanceAccount, type FinanceAccountType } from "@/lib/finance";
import { writeFinanceAuditLog } from "@/services/financeAuditService";

export function financeAccountsCollection(db: Firestore = defaultFirestore) {
  return collection(db, "fin_accounts");
}

export const DEFAULT_ACCOUNTS: Array<{ name: string; type: FinanceAccountType; description: string }> = [
  { name: "Cash Drawer", type: "cash", description: "Physical cash held at the counter" },
  { name: "Canara", type: "bank", description: "Canara Bank account" },
  { name: "IDBI", type: "bank", description: "IDBI Bank account" },
  { name: "ICICI", type: "bank", description: "ICICI Bank account" },
  { name: "Pigmi", type: "pigmi", description: "Daily deposit collection agent — money in transit to a bank account" },
  { name: "Petty Cash", type: "cash", description: "Small day-to-day cash float" },
];

export async function getFinanceAccounts(
  options: { includeArchived?: boolean; branchId?: string } = {},
  db: Firestore = defaultFirestore,
): Promise<FinanceAccount[]> {
  const branchId = options.branchId ?? DEFAULT_BRANCH_ID;
  const snapshot = await getDocs(
    query(financeAccountsCollection(db), where("branchId", "==", branchId), orderBy("displayOrder", "asc")),
  );
  const accounts = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FinanceAccount, "id">) }));
  return options.includeArchived ? accounts : accounts.filter((a) => a.status === "active");
}

export async function getFinanceAccount(accountId: string, db: Firestore = defaultFirestore): Promise<FinanceAccount | null> {
  const snap = await getDoc(doc(financeAccountsCollection(db), accountId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<FinanceAccount, "id">) };
}

export interface CreateFinanceAccountInput {
  name: string;
  type: FinanceAccountType;
  openingBalance: number;
  description?: string;
  branchId?: string;
}

export async function createFinanceAccount(
  input: CreateFinanceAccountInput,
  userId: string,
  userName: string,
  db: Firestore = defaultFirestore,
): Promise<FinanceAccount> {
  const name = input.name.trim();
  if (!name) throw new Error("Account name is required.");

  const branchId = input.branchId ?? DEFAULT_BRANCH_ID;
  const existing = await getDocs(
    query(financeAccountsCollection(db), where("branchId", "==", branchId), where("name", "==", name)),
  );
  if (!existing.empty) throw new Error(`An account named "${name}" already exists.`);

  const currentAccounts = await getDocs(query(financeAccountsCollection(db), where("branchId", "==", branchId)));
  const displayOrder = currentAccounts.size;

  const batch = writeBatch(db);
  const ref = doc(financeAccountsCollection(db));
  const data = {
    name,
    type: input.type,
    openingBalance: input.openingBalance,
    currentBalance: input.openingBalance,
    status: "active" as const,
    branchId,
    description: input.description?.trim() ?? "",
    displayOrder,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  batch.set(ref, data);
  writeFinanceAuditLog(batch, db, {
    module: "account",
    entityId: ref.id,
    entityLabel: name,
    action: "create",
    userId,
    userName,
    newValue: data,
  });
  await batch.commit();

  return { id: ref.id, ...data } as unknown as FinanceAccount;
}

export interface UpdateFinanceAccountInput {
  name?: string;
  description?: string;
  type?: FinanceAccountType;
  displayOrder?: number;
}

export async function updateFinanceAccount(
  accountId: string,
  input: UpdateFinanceAccountInput,
  userId: string,
  userName: string,
  db: Firestore = defaultFirestore,
): Promise<void> {
  const ref = doc(financeAccountsCollection(db), accountId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Account not found.");
  const before = snap.data();

  const updates: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (input.name !== undefined) updates.name = input.name.trim();
  if (input.description !== undefined) updates.description = input.description.trim();
  if (input.type !== undefined) updates.type = input.type;
  if (input.displayOrder !== undefined) updates.displayOrder = input.displayOrder;

  const batch = writeBatch(db);
  batch.update(ref, updates);
  writeFinanceAuditLog(batch, db, {
    module: "account",
    entityId: accountId,
    entityLabel: (input.name ?? before.name) as string,
    action: "update",
    userId,
    userName,
    oldValue: before,
    newValue: updates,
  });
  await batch.commit();
}

/** Accounts are never hard-deleted — archiving preserves ledger history and running balances. */
export async function setFinanceAccountStatus(
  accountId: string,
  status: "active" | "archived",
  userId: string,
  userName: string,
  db: Firestore = defaultFirestore,
): Promise<void> {
  const ref = doc(financeAccountsCollection(db), accountId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Account not found.");
  const before = snap.data();

  if (status === "archived" && before.currentBalance !== 0) {
    throw new Error(
      `Cannot archive "${before.name}" while it still holds a balance of ₹${before.currentBalance}. Transfer the balance out first.`,
    );
  }

  const batch = writeBatch(db);
  batch.update(ref, { status, updatedAt: serverTimestamp() });
  writeFinanceAuditLog(batch, db, {
    module: "account",
    entityId: accountId,
    entityLabel: before.name as string,
    action: status === "archived" ? "archive" : "restore",
    userId,
    userName,
    oldValue: { status: before.status },
    newValue: { status },
  });
  await batch.commit();
}

/** Seeds the default DAJAJ accounts once. Safe to call repeatedly — skips accounts that already exist by name. */
export async function seedDefaultFinanceAccounts(
  userId: string,
  userName: string,
  branchId: string = DEFAULT_BRANCH_ID,
  db: Firestore = defaultFirestore,
): Promise<number> {
  const existing = await getDocs(query(financeAccountsCollection(db), where("branchId", "==", branchId)));
  const existingNames = new Set(existing.docs.map((d) => (d.data().name as string).toLowerCase()));

  const toCreate = DEFAULT_ACCOUNTS.filter((a) => !existingNames.has(a.name.toLowerCase()));
  let created = 0;
  for (const account of toCreate) {
    await createFinanceAccount(
      { name: account.name, type: account.type, openingBalance: 0, description: account.description, branchId },
      userId,
      userName,
      db,
    );
    created += 1;
  }
  return created;
}
