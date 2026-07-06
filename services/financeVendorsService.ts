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
import { firestore as defaultFirestore } from "@/lib/firebase";
import { DEFAULT_BRANCH_ID, type FinanceVendor } from "@/lib/finance";
import { writeFinanceAuditLog } from "@/services/financeAuditService";

function vendorsCollection(db: Firestore) {
  return collection(db, "fin_vendors");
}

export async function getFinanceVendors(
  options: { includeInactive?: boolean; branchId?: string } = {},
  db: Firestore = defaultFirestore,
): Promise<FinanceVendor[]> {
  const branchId = options.branchId ?? DEFAULT_BRANCH_ID;
  const snapshot = await getDocs(query(vendorsCollection(db), where("branchId", "==", branchId), orderBy("name", "asc")));
  const rows = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FinanceVendor, "id">) }));
  return options.includeInactive ? rows : rows.filter((v) => v.active);
}

export async function getFinanceVendor(vendorId: string, db: Firestore = defaultFirestore): Promise<FinanceVendor | null> {
  const snap = await getDoc(doc(vendorsCollection(db), vendorId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<FinanceVendor, "id">) };
}

export interface UpsertFinanceVendorInput {
  name: string;
  phone?: string;
  gstNumber?: string;
  address?: string;
  notes?: string;
  defaultExpenseCategoryId?: string | null;
  defaultExpenseCategoryName?: string | null;
  branchId?: string;
}

export async function createFinanceVendor(
  input: UpsertFinanceVendorInput,
  userId: string,
  userName: string,
  db: Firestore = defaultFirestore,
): Promise<FinanceVendor> {
  const name = input.name.trim();
  if (!name) throw new Error("Vendor name is required.");
  const branchId = input.branchId ?? DEFAULT_BRANCH_ID;

  const dup = await getDocs(query(vendorsCollection(db), where("branchId", "==", branchId), where("name", "==", name)));
  if (!dup.empty) throw new Error(`Vendor "${name}" already exists.`);

  const batch = writeBatch(db);
  const ref = doc(vendorsCollection(db));
  const data = {
    name,
    phone: input.phone?.trim() ?? "",
    gstNumber: input.gstNumber?.trim() ?? "",
    address: input.address?.trim() ?? "",
    notes: input.notes?.trim() ?? "",
    defaultExpenseCategoryId: input.defaultExpenseCategoryId ?? null,
    defaultExpenseCategoryName: input.defaultExpenseCategoryName ?? null,
    active: true,
    totalPurchases: 0,
    transactionCount: 0,
    branchId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  batch.set(ref, data);
  writeFinanceAuditLog(batch, db, {
    module: "vendor",
    entityId: ref.id,
    entityLabel: name,
    action: "create",
    userId,
    userName,
    newValue: data,
  });
  await batch.commit();
  return { id: ref.id, ...data } as unknown as FinanceVendor;
}

export async function updateFinanceVendor(
  vendorId: string,
  input: Partial<UpsertFinanceVendorInput> & { active?: boolean },
  userId: string,
  userName: string,
  db: Firestore = defaultFirestore,
): Promise<void> {
  const ref = doc(vendorsCollection(db), vendorId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Vendor not found.");
  const before = snap.data();

  const updates: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (input.name !== undefined) updates.name = input.name.trim();
  if (input.phone !== undefined) updates.phone = input.phone.trim();
  if (input.gstNumber !== undefined) updates.gstNumber = input.gstNumber.trim();
  if (input.address !== undefined) updates.address = input.address.trim();
  if (input.notes !== undefined) updates.notes = input.notes.trim();
  if (input.defaultExpenseCategoryId !== undefined) updates.defaultExpenseCategoryId = input.defaultExpenseCategoryId;
  if (input.defaultExpenseCategoryName !== undefined) updates.defaultExpenseCategoryName = input.defaultExpenseCategoryName;
  if (input.active !== undefined) updates.active = input.active;

  const batch = writeBatch(db);
  batch.update(ref, updates);
  writeFinanceAuditLog(batch, db, {
    module: "vendor",
    entityId: vendorId,
    entityLabel: (input.name ?? before.name) as string,
    action: input.active === false ? "archive" : input.active === true ? "restore" : "update",
    userId,
    userName,
    oldValue: before,
    newValue: updates,
  });
  await batch.commit();
}

export async function deleteFinanceVendor(vendorId: string, userId: string, userName: string, db: Firestore = defaultFirestore): Promise<void> {
  const ref = doc(vendorsCollection(db), vendorId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Vendor not found.");
  const data = snap.data();
  if ((data.transactionCount ?? 0) > 0) {
    throw new Error(`"${data.name}" has ${data.transactionCount} transaction(s) and cannot be deleted. Mark inactive instead.`);
  }

  const batch = writeBatch(db);
  batch.delete(ref);
  writeFinanceAuditLog(batch, db, {
    module: "vendor",
    entityId: vendorId,
    entityLabel: data.name as string,
    action: "archive",
    userId,
    userName,
    oldValue: data,
    reason: "Deleted (no transactions existed)",
  });
  await batch.commit();
}
