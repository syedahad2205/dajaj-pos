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
import {
  DEFAULT_BRANCH_ID,
  type FinanceExpenseCategory,
  type FinanceExpenseSubcategory,
  type FinanceIncomeCategory,
} from "@/lib/finance";
import { writeFinanceAuditLog } from "@/services/financeAuditService";

// ─── Defaults from the spec ─────────────────────────────────────────────────

export const DEFAULT_EXPENSE_CATEGORIES = [
  "Chicken",
  "Vegetables",
  "Oil",
  "Rice",
  "Salary",
  "Packaging",
  "Marketing",
  "Maintenance",
  "Cleaning",
  "Gas",
  "Fuel",
  "Electricity",
  "Internet",
  "Rent",
  "Milk",
  "Misc",
];

export const DEFAULT_EXPENSE_SUBCATEGORIES: Record<string, string[]> = {
  Chicken: ["Fresh Chicken", "Boneless", "Wings"],
  Packaging: ["Boxes", "Carry Bags", "Butter Paper", "Tissues"],
  Vegetables: ["Onion", "Tomato", "Coriander", "Chilli"],
};

export const DEFAULT_INCOME_CATEGORIES = ["Cash Sale", "UPI Sale", "Zomato Settlement", "Swiggy Settlement", "Refund Received", "Other Income"];

function expenseCategoriesCollection(db: Firestore) {
  return collection(db, "fin_expense_categories");
}

function expenseSubcategoriesCollection(db: Firestore) {
  return collection(db, "fin_expense_subcategories");
}

function incomeCategoriesCollection(db: Firestore) {
  return collection(db, "fin_income_categories");
}

// ─── Expense Categories ─────────────────────────────────────────────────────

export async function getExpenseCategories(
  options: { includeInactive?: boolean; branchId?: string } = {},
  db: Firestore = defaultFirestore,
): Promise<FinanceExpenseCategory[]> {
  const branchId = options.branchId ?? DEFAULT_BRANCH_ID;
  const snapshot = await getDocs(
    query(expenseCategoriesCollection(db), where("branchId", "==", branchId), orderBy("displayOrder", "asc")),
  );
  const rows = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FinanceExpenseCategory, "id">) }));
  return options.includeInactive ? rows : rows.filter((r) => r.active);
}

export interface UpsertExpenseCategoryInput {
  name: string;
  icon?: string;
  color?: string;
  description?: string;
  branchId?: string;
}

export async function createExpenseCategory(
  input: UpsertExpenseCategoryInput,
  userId: string,
  userName: string,
  db: Firestore = defaultFirestore,
): Promise<FinanceExpenseCategory> {
  const name = input.name.trim();
  if (!name) throw new Error("Category name is required.");
  const branchId = input.branchId ?? DEFAULT_BRANCH_ID;

  const dup = await getDocs(
    query(expenseCategoriesCollection(db), where("branchId", "==", branchId), where("name", "==", name)),
  );
  if (!dup.empty) throw new Error(`Expense category "${name}" already exists.`);

  const existingCount = (await getDocs(query(expenseCategoriesCollection(db), where("branchId", "==", branchId)))).size;

  const batch = writeBatch(db);
  const ref = doc(expenseCategoriesCollection(db));
  const data = {
    name,
    active: true,
    displayOrder: existingCount,
    icon: input.icon?.trim() ?? "",
    color: input.color?.trim() ?? "#f97316",
    description: input.description?.trim() ?? "",
    transactionCount: 0,
    branchId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  batch.set(ref, data);
  writeFinanceAuditLog(batch, db, {
    module: "expense_category",
    entityId: ref.id,
    entityLabel: name,
    action: "create",
    userId,
    userName,
    newValue: data,
  });
  await batch.commit();
  return { id: ref.id, ...data } as unknown as FinanceExpenseCategory;
}

/**
 * Finds an expense category by exact name (active or not), or creates a
 * new active one. Mirrors getOrCreateIncomeCategoryIdByName — used for
 * auto-generated expense postings like "Zomato Settlement Deduction" where
 * a matching category should always exist without an admin pre-creating it.
 */
export async function getOrCreateExpenseCategoryIdByName(
  name: string,
  userId: string,
  userName: string,
  db: Firestore = defaultFirestore,
  branchId: string = DEFAULT_BRANCH_ID,
): Promise<string> {
  const existing = await getDocs(
    query(expenseCategoriesCollection(db), where("branchId", "==", branchId), where("name", "==", name)),
  );
  if (!existing.empty) return existing.docs[0].id;
  const created = await createExpenseCategory({ name, branchId }, userId, userName, db);
  return created.id;
}

export async function updateExpenseCategory(
  categoryId: string,
  input: Partial<UpsertExpenseCategoryInput> & { active?: boolean; displayOrder?: number },
  userId: string,
  userName: string,
  db: Firestore = defaultFirestore,
): Promise<void> {
  const ref = doc(expenseCategoriesCollection(db), categoryId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Expense category not found.");
  const before = snap.data();

  const updates: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (input.name !== undefined) updates.name = input.name.trim();
  if (input.icon !== undefined) updates.icon = input.icon.trim();
  if (input.color !== undefined) updates.color = input.color.trim();
  if (input.description !== undefined) updates.description = input.description.trim();
  if (input.active !== undefined) updates.active = input.active;
  if (input.displayOrder !== undefined) updates.displayOrder = input.displayOrder;

  const batch = writeBatch(db);
  batch.update(ref, updates);
  writeFinanceAuditLog(batch, db, {
    module: "expense_category",
    entityId: categoryId,
    entityLabel: (input.name ?? before.name) as string,
    action: input.active === false ? "archive" : input.active === true ? "restore" : "update",
    userId,
    userName,
    oldValue: before,
    newValue: updates,
  });
  await batch.commit();
}

/** Categories with transactions can never be deleted — only archived (active=false) — so historical ledger entries keep a valid category reference. */
export async function deleteExpenseCategory(categoryId: string, userId: string, userName: string, db: Firestore = defaultFirestore): Promise<void> {
  const ref = doc(expenseCategoriesCollection(db), categoryId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Expense category not found.");
  const data = snap.data();
  if ((data.transactionCount ?? 0) > 0) {
    throw new Error(`"${data.name}" has ${data.transactionCount} transaction(s) and cannot be deleted. Archive it instead.`);
  }

  const subcats = await getDocs(query(expenseSubcategoriesCollection(db), where("categoryId", "==", categoryId)));
  if (!subcats.empty) {
    throw new Error(`"${data.name}" has subcategories. Delete or reassign them first.`);
  }

  const batch = writeBatch(db);
  batch.delete(ref);
  writeFinanceAuditLog(batch, db, {
    module: "expense_category",
    entityId: categoryId,
    entityLabel: data.name as string,
    action: "archive",
    userId,
    userName,
    oldValue: data,
    reason: "Deleted (no transactions existed)",
  });
  await batch.commit();
}

// ─── Expense Subcategories ──────────────────────────────────────────────────

export async function getExpenseSubcategories(
  options: { categoryId?: string; includeInactive?: boolean } = {},
  db: Firestore = defaultFirestore,
): Promise<FinanceExpenseSubcategory[]> {
  const constraints = options.categoryId ? [where("categoryId", "==", options.categoryId)] : [];
  const snapshot = await getDocs(query(expenseSubcategoriesCollection(db), ...constraints, orderBy("displayOrder", "asc")));
  const rows = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FinanceExpenseSubcategory, "id">) }));
  return options.includeInactive ? rows : rows.filter((r) => r.active);
}

export async function createExpenseSubcategory(
  input: { categoryId: string; name: string },
  userId: string,
  userName: string,
  db: Firestore = defaultFirestore,
): Promise<FinanceExpenseSubcategory> {
  const name = input.name.trim();
  if (!name) throw new Error("Subcategory name is required.");

  const categorySnap = await getDoc(doc(expenseCategoriesCollection(db), input.categoryId));
  if (!categorySnap.exists()) throw new Error("Parent expense category not found.");
  const categoryName = categorySnap.data().name as string;

  const dup = await getDocs(
    query(expenseSubcategoriesCollection(db), where("categoryId", "==", input.categoryId), where("name", "==", name)),
  );
  if (!dup.empty) throw new Error(`Subcategory "${name}" already exists under ${categoryName}.`);

  const existingCount = (await getDocs(query(expenseSubcategoriesCollection(db), where("categoryId", "==", input.categoryId)))).size;

  const batch = writeBatch(db);
  const ref = doc(expenseSubcategoriesCollection(db));
  const data = {
    categoryId: input.categoryId,
    categoryName,
    name,
    active: true,
    displayOrder: existingCount,
    transactionCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  batch.set(ref, data);
  writeFinanceAuditLog(batch, db, {
    module: "expense_subcategory",
    entityId: ref.id,
    entityLabel: `${categoryName} · ${name}`,
    action: "create",
    userId,
    userName,
    newValue: data,
  });
  await batch.commit();
  return { id: ref.id, ...data } as unknown as FinanceExpenseSubcategory;
}

export async function updateExpenseSubcategory(
  subcategoryId: string,
  input: { name?: string; active?: boolean; displayOrder?: number },
  userId: string,
  userName: string,
  db: Firestore = defaultFirestore,
): Promise<void> {
  const ref = doc(expenseSubcategoriesCollection(db), subcategoryId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Subcategory not found.");
  const before = snap.data();

  const updates: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (input.name !== undefined) updates.name = input.name.trim();
  if (input.active !== undefined) updates.active = input.active;
  if (input.displayOrder !== undefined) updates.displayOrder = input.displayOrder;

  const batch = writeBatch(db);
  batch.update(ref, updates);
  writeFinanceAuditLog(batch, db, {
    module: "expense_subcategory",
    entityId: subcategoryId,
    entityLabel: `${before.categoryName} · ${input.name ?? before.name}`,
    action: input.active === false ? "archive" : input.active === true ? "restore" : "update",
    userId,
    userName,
    oldValue: before,
    newValue: updates,
  });
  await batch.commit();
}

export async function deleteExpenseSubcategory(subcategoryId: string, userId: string, userName: string, db: Firestore = defaultFirestore): Promise<void> {
  const ref = doc(expenseSubcategoriesCollection(db), subcategoryId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Subcategory not found.");
  const data = snap.data();
  if ((data.transactionCount ?? 0) > 0) {
    throw new Error(`"${data.name}" has ${data.transactionCount} transaction(s) and cannot be deleted. Archive it instead.`);
  }

  const batch = writeBatch(db);
  batch.delete(ref);
  writeFinanceAuditLog(batch, db, {
    module: "expense_subcategory",
    entityId: subcategoryId,
    entityLabel: `${data.categoryName} · ${data.name}`,
    action: "archive",
    userId,
    userName,
    oldValue: data,
    reason: "Deleted (no transactions existed)",
  });
  await batch.commit();
}

// ─── Income Categories ──────────────────────────────────────────────────────

export async function getIncomeCategories(
  options: { includeInactive?: boolean; branchId?: string } = {},
  db: Firestore = defaultFirestore,
): Promise<FinanceIncomeCategory[]> {
  const branchId = options.branchId ?? DEFAULT_BRANCH_ID;
  const snapshot = await getDocs(
    query(incomeCategoriesCollection(db), where("branchId", "==", branchId), orderBy("displayOrder", "asc")),
  );
  const rows = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FinanceIncomeCategory, "id">) }));
  return options.includeInactive ? rows : rows.filter((r) => r.active);
}

/**
 * Finds an income category by exact name (active or not), or creates a new
 * active one. Used when Daily Closing auto-posts a Finance Defaults event
 * (e.g. "UPI Sales") to the ledger — the event name doubles as the
 * category name, so a matching category always exists without requiring
 * an admin to pre-create it.
 */
export async function getOrCreateIncomeCategoryIdByName(
  name: string,
  userId: string,
  userName: string,
  db: Firestore = defaultFirestore,
  branchId: string = DEFAULT_BRANCH_ID,
): Promise<string> {
  const existing = await getDocs(
    query(incomeCategoriesCollection(db), where("branchId", "==", branchId), where("name", "==", name)),
  );
  if (!existing.empty) return existing.docs[0].id;
  const created = await createIncomeCategory({ name, branchId }, userId, userName, db);
  return created.id;
}

export async function createIncomeCategory(
  input: UpsertExpenseCategoryInput,
  userId: string,
  userName: string,
  db: Firestore = defaultFirestore,
): Promise<FinanceIncomeCategory> {
  const name = input.name.trim();
  if (!name) throw new Error("Category name is required.");
  const branchId = input.branchId ?? DEFAULT_BRANCH_ID;

  const dup = await getDocs(
    query(incomeCategoriesCollection(db), where("branchId", "==", branchId), where("name", "==", name)),
  );
  if (!dup.empty) throw new Error(`Income category "${name}" already exists.`);

  const existingCount = (await getDocs(query(incomeCategoriesCollection(db), where("branchId", "==", branchId)))).size;

  const batch = writeBatch(db);
  const ref = doc(incomeCategoriesCollection(db));
  const data = {
    name,
    active: true,
    displayOrder: existingCount,
    icon: input.icon?.trim() ?? "",
    color: input.color?.trim() ?? "#16a34a",
    description: input.description?.trim() ?? "",
    transactionCount: 0,
    branchId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  batch.set(ref, data);
  writeFinanceAuditLog(batch, db, {
    module: "income_category",
    entityId: ref.id,
    entityLabel: name,
    action: "create",
    userId,
    userName,
    newValue: data,
  });
  await batch.commit();
  return { id: ref.id, ...data } as unknown as FinanceIncomeCategory;
}

export async function updateIncomeCategory(
  categoryId: string,
  input: Partial<UpsertExpenseCategoryInput> & { active?: boolean; displayOrder?: number },
  userId: string,
  userName: string,
  db: Firestore = defaultFirestore,
): Promise<void> {
  const ref = doc(incomeCategoriesCollection(db), categoryId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Income category not found.");
  const before = snap.data();

  const updates: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (input.name !== undefined) updates.name = input.name.trim();
  if (input.icon !== undefined) updates.icon = input.icon.trim();
  if (input.color !== undefined) updates.color = input.color.trim();
  if (input.description !== undefined) updates.description = input.description.trim();
  if (input.active !== undefined) updates.active = input.active;
  if (input.displayOrder !== undefined) updates.displayOrder = input.displayOrder;

  const batch = writeBatch(db);
  batch.update(ref, updates);
  writeFinanceAuditLog(batch, db, {
    module: "income_category",
    entityId: categoryId,
    entityLabel: (input.name ?? before.name) as string,
    action: input.active === false ? "archive" : input.active === true ? "restore" : "update",
    userId,
    userName,
    oldValue: before,
    newValue: updates,
  });
  await batch.commit();
}

export async function deleteIncomeCategory(categoryId: string, userId: string, userName: string, db: Firestore = defaultFirestore): Promise<void> {
  const ref = doc(incomeCategoriesCollection(db), categoryId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Income category not found.");
  const data = snap.data();
  if ((data.transactionCount ?? 0) > 0) {
    throw new Error(`"${data.name}" has ${data.transactionCount} transaction(s) and cannot be deleted. Archive it instead.`);
  }

  const batch = writeBatch(db);
  batch.delete(ref);
  writeFinanceAuditLog(batch, db, {
    module: "income_category",
    entityId: categoryId,
    entityLabel: data.name as string,
    action: "archive",
    userId,
    userName,
    oldValue: data,
    reason: "Deleted (no transactions existed)",
  });
  await batch.commit();
}

// ─── Seeding ─────────────────────────────────────────────────────────────────

export async function seedDefaultFinanceCategories(
  userId: string,
  userName: string,
  branchId: string = DEFAULT_BRANCH_ID,
  db: Firestore = defaultFirestore,
): Promise<{ expenseCategories: number; expenseSubcategories: number; incomeCategories: number }> {
  const existingExpense = await getDocs(query(expenseCategoriesCollection(db), where("branchId", "==", branchId)));
  const existingExpenseNames = new Map(existingExpense.docs.map((d) => [(d.data().name as string).toLowerCase(), d.id]));

  let expenseCategoriesCreated = 0;
  const categoryIdByName = new Map<string, string>(existingExpenseNames);
  for (const name of DEFAULT_EXPENSE_CATEGORIES) {
    if (categoryIdByName.has(name.toLowerCase())) continue;
    const created = await createExpenseCategory({ name, branchId }, userId, userName, db);
    categoryIdByName.set(name.toLowerCase(), created.id);
    expenseCategoriesCreated += 1;
  }

  let expenseSubcategoriesCreated = 0;
  for (const [categoryName, subcats] of Object.entries(DEFAULT_EXPENSE_SUBCATEGORIES)) {
    const categoryId = categoryIdByName.get(categoryName.toLowerCase());
    if (!categoryId) continue;
    const existingSub = await getDocs(query(expenseSubcategoriesCollection(db), where("categoryId", "==", categoryId)));
    const existingSubNames = new Set(existingSub.docs.map((d) => (d.data().name as string).toLowerCase()));
    for (const subName of subcats) {
      if (existingSubNames.has(subName.toLowerCase())) continue;
      await createExpenseSubcategory({ categoryId, name: subName }, userId, userName, db);
      expenseSubcategoriesCreated += 1;
    }
  }

  const existingIncome = await getDocs(query(incomeCategoriesCollection(db), where("branchId", "==", branchId)));
  const existingIncomeNames = new Set(existingIncome.docs.map((d) => (d.data().name as string).toLowerCase()));
  let incomeCategoriesCreated = 0;
  for (const name of DEFAULT_INCOME_CATEGORIES) {
    if (existingIncomeNames.has(name.toLowerCase())) continue;
    await createIncomeCategory({ name, branchId }, userId, userName, db);
    incomeCategoriesCreated += 1;
  }

  return {
    expenseCategories: expenseCategoriesCreated,
    expenseSubcategories: expenseSubcategoriesCreated,
    incomeCategories: incomeCategoriesCreated,
  };
}
