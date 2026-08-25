import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import { firestore as defaultFirestore } from "@/lib/firebase";
import { DEFAULT_BRANCH_ID } from "@/lib/finance";
import { normalizePayeeText, payeeTextsLooselyMatch, type QuickEntryPayeeRule } from "@/lib/quickEntry";
import { getExpenseCategories, getOrCreateExpenseCategoryIdByName } from "@/services/financeCategoriesService";

// ─────────────────────────────────────────────────────────────────────────
// Payee → Expense Category rules for Quick Entry (spec §8/§9/§25).
//
// Deliberately a brand-new, independent collection (quick_entry_payee_rules)
// — NOT a change to fin_expense_categories. Categories themselves always
// come from the existing category system (getOrCreateExpenseCategoryIdByName
// below, same function Zomato settlement / Daily Closing auto-posting
// already use); this collection only stores the *mapping* from a payee's
// text to one of those existing category ids, so it can be extended (new
// payee → category rules) without any code change or touching the category
// schema.
//
// Matching priority (spec §9) is enforced by the CALLER
// (services/quickEntryService.ts), not here: manual selection first, then
// these explicit rules, then any AI suggestion, then "ask the Finance
// Manager". This file only implements step 2.
// ─────────────────────────────────────────────────────────────────────────

function payeeRulesCollection(db: Firestore) {
  return collection(db, "quick_entry_payee_rules");
}

export interface GetPayeeRulesOptions {
  includeInactive?: boolean;
  branchId?: string;
}

export async function getPayeeRules(
  options: GetPayeeRulesOptions = {},
  db: Firestore = defaultFirestore,
): Promise<QuickEntryPayeeRule[]> {
  const branchId = options.branchId ?? DEFAULT_BRANCH_ID;
  // Sorted in memory (not via Firestore orderBy) so this never needs a new
  // composite index — same "equality filter only, sort/filter in memory"
  // trade-off listFinanceTransactions already makes elsewhere in this app.
  // This collection is small (a handful of payee rules), so it's cheap.
  const snapshot = await getDocs(query(payeeRulesCollection(db), where("branchId", "==", branchId)));
  const rules = snapshot.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<QuickEntryPayeeRule, "id">) }))
    .sort((a, b) => a.payeeLabel.localeCompare(b.payeeLabel));
  return options.includeInactive ? rules : rules.filter((r) => r.active);
}

export interface CreatePayeeRuleInput {
  payeeLabel: string;
  categoryId: string;
  branchId?: string;
}

async function resolveCategoryName(categoryId: string, db: Firestore, branchId: string): Promise<string> {
  const categories = await getExpenseCategories({ includeInactive: true, branchId }, db);
  const match = categories.find((c) => c.id === categoryId);
  if (!match) throw new Error("Selected expense category no longer exists.");
  return match.name;
}

export async function createPayeeRule(
  input: CreatePayeeRuleInput,
  userId: string,
  userName: string,
  db: Firestore = defaultFirestore,
): Promise<QuickEntryPayeeRule> {
  const payeeLabel = input.payeeLabel.trim();
  if (!payeeLabel) throw new Error("Payee text is required.");
  if (!input.categoryId) throw new Error("Expense category is required.");
  const branchId = input.branchId ?? DEFAULT_BRANCH_ID;
  const matchKey = normalizePayeeText(payeeLabel);
  if (!matchKey) throw new Error("Payee text is required.");

  const categoryName = await resolveCategoryName(input.categoryId, db, branchId);

  const existing = await getDocs(query(payeeRulesCollection(db), where("branchId", "==", branchId), where("matchKey", "==", matchKey)));
  if (!existing.empty) throw new Error(`A rule for "${payeeLabel}" already exists.`);

  const ref = doc(payeeRulesCollection(db));
  const data = {
    matchKey,
    payeeLabel,
    categoryId: input.categoryId,
    categoryName,
    active: true,
    branchId,
    createdBy: userId,
    createdByName: userName,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(ref, data);
  return { id: ref.id, ...data } as unknown as QuickEntryPayeeRule;
}

export interface UpdatePayeeRuleInput {
  payeeLabel?: string;
  categoryId?: string;
  active?: boolean;
}

export async function updatePayeeRule(
  ruleId: string,
  input: UpdatePayeeRuleInput,
  db: Firestore = defaultFirestore,
): Promise<void> {
  const ref = doc(payeeRulesCollection(db), ruleId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Payee rule not found.");
  const before = snap.data() as Omit<QuickEntryPayeeRule, "id">;

  const updates: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (input.payeeLabel !== undefined) {
    const payeeLabel = input.payeeLabel.trim();
    if (!payeeLabel) throw new Error("Payee text is required.");
    updates.payeeLabel = payeeLabel;
    updates.matchKey = normalizePayeeText(payeeLabel);
  }
  if (input.categoryId !== undefined) {
    updates.categoryId = input.categoryId;
    updates.categoryName = await resolveCategoryName(input.categoryId, db, before.branchId);
  }
  if (input.active !== undefined) updates.active = input.active;

  await updateDoc(ref, updates);
}

/**
 * Finds the first active rule whose payee text loosely matches the given
 * raw payee string (case/spacing/punctuation-tolerant — see
 * payeeTextsLooselyMatch). Returns null if nothing matches, in which case
 * the caller falls through to the next step in the §9 priority order (AI
 * suggestion, then manual selection).
 */
export async function matchPayeeRule(
  payeeRaw: string,
  db: Firestore = defaultFirestore,
  branchId: string = DEFAULT_BRANCH_ID,
): Promise<QuickEntryPayeeRule | null> {
  const trimmed = payeeRaw?.trim();
  if (!trimmed) return null;

  const rules = await getPayeeRules({ branchId }, db);
  return rules.find((rule) => payeeTextsLooselyMatch(rule.payeeLabel, trimmed)) ?? null;
}

/**
 * Picks an existing expense category by trying each candidate name in
 * order (case-insensitive exact match) — e.g. "Chicken" before "Chicken
 * Expense" — so a category that already exists in this deployment (like
 * DAJAJ's own "Chicken"/"Khuboos") is always preferred over creating a new,
 * differently-named one. Only creates a brand-new category (via
 * getOrCreateExpenseCategoryIdByName, the first candidate name) if NONE of
 * the candidates already exist.
 */
async function resolvePreferredCategory(
  candidateNames: string[],
  existingCategories: Array<{ id: string; name: string }>,
  userId: string,
  userName: string,
  db: Firestore,
  branchId: string,
): Promise<{ id: string; name: string }> {
  for (const name of candidateNames) {
    const match = existingCategories.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (match) return { id: match.id, name: match.name };
  }
  const name = candidateNames[0];
  const id = await getOrCreateExpenseCategoryIdByName(name, userId, userName, db, branchId);
  return { id, name };
}

/**
 * Idempotently seeds the two required built-in rules (spec §8): Fayeeq MH →
 * an existing "Chicken"-type category, Sana Bakery → an existing
 * "Khuboos"-type category. Safe to call on every page load (like
 * migrateLegacySettlementDefaults elsewhere in this module).
 *
 * Always prefers a category that already exists in THIS deployment (see
 * resolvePreferredCategory) over creating a new one — DAJAJ already has
 * "Chicken" and "Khuboos" categories, so those are used directly instead of
 * spawning duplicate "Chicken Expense"/"Khuboos Expense" categories.
 *
 * Self-healing: if a rule for this payee already exists but points at a
 * DIFFERENT category than the one just resolved (e.g. an earlier run of
 * this function created a duplicate category before this preference logic
 * existed), it's repaired in place rather than left wrong forever — this
 * runs on every Quick Entry analysis, so a bad mapping fixes itself on the
 * next screenshot without needing a manual data migration.
 */
export async function seedDefaultPayeeRules(
  userId: string,
  userName: string,
  db: Firestore = defaultFirestore,
  branchId: string = DEFAULT_BRANCH_ID,
): Promise<void> {
  const defaults: Array<{ payeeLabel: string; candidateCategoryNames: string[] }> = [
    { payeeLabel: "Fayeeq MH", candidateCategoryNames: ["Chicken", "Chicken Expense"] },
    { payeeLabel: "Sana Bakery", candidateCategoryNames: ["Khuboos", "Khuboos Expense"] },
  ];

  const existingCategories = await getExpenseCategories({ includeInactive: true, branchId }, db);

  for (const def of defaults) {
    const matchKey = normalizePayeeText(def.payeeLabel);
    const resolved = await resolvePreferredCategory(def.candidateCategoryNames, existingCategories, userId, userName, db, branchId);

    const existing = await getDocs(query(payeeRulesCollection(db), where("branchId", "==", branchId), where("matchKey", "==", matchKey)));

    if (existing.empty) {
      const ref = doc(payeeRulesCollection(db));
      await setDoc(ref, {
        matchKey,
        payeeLabel: def.payeeLabel,
        categoryId: resolved.id,
        categoryName: resolved.name,
        active: true,
        branchId,
        createdBy: userId,
        createdByName: userName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      continue;
    }

    const existingDoc = existing.docs[0];
    const existingData = existingDoc.data() as Omit<QuickEntryPayeeRule, "id">;
    if (existingData.categoryId !== resolved.id) {
      await updateDoc(doc(payeeRulesCollection(db), existingDoc.id), {
        categoryId: resolved.id,
        categoryName: resolved.name,
        updatedAt: serverTimestamp(),
      });
    }
  }
}
