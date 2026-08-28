/**
 * Swiggy item → menu-category mapping
 *
 * Swiggy's "Past Orders" report (the only report with item-level detail —
 * see lib/swiggyCsvParser.ts) never tells you what category an item belongs
 * to, unlike Zomato's Item Sales Report which has a "Item category" column
 * built in. So category has to be resolved against a small, persistent,
 * admin-editable map instead of trusted from the file each time.
 *
 * Collection: swiggy_item_categories — one doc per known item name, NOT
 * scoped to any single import (unlike zomato_category_summary/item_summary,
 * which are per-import). This is intentionally the same shape/spirit as the
 * "resolve or ask" ladder used elsewhere in Finance (never invent a
 * category — fall back to a clearly-flagged "Uncategorized" instead):
 *
 *   1. Exact match (case/whitespace-insensitive) against the map
 *   2. Fuzzy match (payeeTextsLooselyMatch) against the map
 *   3. Bootstrap from Zomato's own item history (zomato_item_summary) —
 *      most items are sold on both platforms, and Zomato's CSV already
 *      tags every item with a category, so this is a free, accurate source
 *      for anything not yet manually mapped for Swiggy.
 *   4. "Uncategorized" — surfaced in the UI so it can be fixed once and
 *      then it's remembered forever.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Firestore,
} from 'firebase/firestore';
import { firestore as defaultFirestore } from '@/lib/firebase';
import { payeeTextsLooselyMatch } from '@/lib/quickEntry';

export interface SwiggyItemCategory {
  id: string;
  itemName: string;
  category: string;
  subCategory: string;
  source: 'seed' | 'manual' | 'zomato_bootstrap' | 'unmapped';
}

export type CategoryMatchSource = 'exact' | 'fuzzy' | 'zomato_bootstrap' | 'unmatched';

const mapCol = (db: Firestore) => collection(db, 'swiggy_item_categories');
const zomatoItemSummaryCol = (db: Firestore) => collection(db, 'zomato_item_summary');

function slugifyItemName(itemName: string): string {
  return itemName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'item';
}

// ── Seed data ──────────────────────────────────────────────────────────────────
// Cool Corner items, straight from the restaurant's own Swiggy menu manager
// (Cool Corner → Mojito / Special Milkshakes / Milkshakes sub-categories).
// Note: "Passion Fruit Mojito" is filed under the "Milkshakes" sub-category
// on the actual menu (not "Mojito") — kept as-is rather than "corrected",
// since this mirrors the menu manager exactly and the sub-category doesn't
// affect the Cool Corner rollup either way.

export const SWIGGY_COOL_CORNER_SEED: { itemName: string; subCategory: string }[] = [
  // Mojito
  { itemName: 'Blue Rock Mojito', subCategory: 'Mojito' },
  { itemName: 'Green Apple Mojito', subCategory: 'Mojito' },
  { itemName: 'Mint & Lime Mojito', subCategory: 'Mojito' },
  { itemName: 'Blueberry Mojito', subCategory: 'Mojito' },
  // Special Milkshakes
  { itemName: 'Avocado Milkshake', subCategory: 'Special Milkshakes' },
  { itemName: 'Tender Coconut Milkshake', subCategory: 'Special Milkshakes' },
  { itemName: 'Muskmelon Milkshake', subCategory: 'Special Milkshakes' },
  // Milkshakes
  { itemName: 'Oreo Milkshake', subCategory: 'Milkshakes' },
  { itemName: 'Horlicks Milkshake', subCategory: 'Milkshakes' },
  { itemName: 'Cold Coffee', subCategory: 'Milkshakes' },
  { itemName: 'Boost Milkshake', subCategory: 'Milkshakes' },
  { itemName: 'Chocolate Milkshake', subCategory: 'Milkshakes' },
  { itemName: 'Vanilla Milkshake', subCategory: 'Milkshakes' },
  { itemName: 'Butterscotch Milkshake', subCategory: 'Milkshakes' },
  { itemName: 'Blackcurrant Milkshake', subCategory: 'Milkshakes' },
  { itemName: 'Pistachio Milkshake', subCategory: 'Milkshakes' },
  { itemName: 'Strawberry Milkshake', subCategory: 'Milkshakes' },
  { itemName: 'Passion Fruit Mojito', subCategory: 'Milkshakes' },
];

export const COOL_CORNER_CATEGORY = 'Cool Corner';

/** Idempotent — safe to call on every import. Only inserts items that don't already have a doc. */
export async function ensureSwiggySeedCategories(db: Firestore = defaultFirestore): Promise<void> {
  for (const seed of SWIGGY_COOL_CORNER_SEED) {
    const id = slugifyItemName(seed.itemName);
    const ref = doc(mapCol(db), id);
    const snap = await getDoc(ref);
    if (snap.exists()) continue;
    await setDoc(ref, {
      itemName: seed.itemName,
      category: COOL_CORNER_CATEGORY,
      subCategory: seed.subCategory,
      source: 'seed' as const,
      updatedAt: serverTimestamp(),
    });
  }
}

export async function getAllSwiggyItemCategories(
  db: Firestore = defaultFirestore,
): Promise<SwiggyItemCategory[]> {
  const snap = await getDocs(mapCol(db));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as SwiggyItemCategory))
    .sort((a, b) => a.itemName.localeCompare(b.itemName));
}

export async function upsertSwiggyItemCategory(
  itemName: string,
  category: string,
  subCategory: string,
  db: Firestore = defaultFirestore,
): Promise<void> {
  const id = slugifyItemName(itemName);
  await setDoc(doc(mapCol(db), id), {
    itemName: itemName.trim(),
    category: category.trim(),
    subCategory: subCategory.trim(),
    source: 'manual' as const,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Builds an itemName → category lookup from Zomato's own sales history
 * (zomato_item_summary spans every Zomato import). Used as a free fallback
 * for any Swiggy item that hasn't been manually mapped yet — most menu
 * items are sold on both platforms and Zomato's report already tags every
 * item's category. Ties broken by first-seen (doesn't matter in practice;
 * an item's category basically never changes).
 */
export async function getZomatoCategoryBootstrapMap(
  db: Firestore = defaultFirestore,
): Promise<Map<string, { category: string; subCategory: string }>> {
  const snap = await getDocs(zomatoItemSummaryCol(db));
  const map = new Map<string, { category: string; subCategory: string }>();
  for (const d of snap.docs) {
    const data = d.data() as { itemName?: string; category?: string; subCategory?: string };
    const name = data.itemName?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (map.has(key)) continue;
    map.set(key, { category: data.category || 'Uncategorized', subCategory: data.subCategory || '' });
  }
  return map;
}

export interface CategoryResolution {
  category: string;
  subCategory: string;
  source: CategoryMatchSource;
}

/**
 * Resolves a single Swiggy item name to a category using the ladder:
 * exact match → fuzzy match → Zomato history bootstrap → "Uncategorized".
 * Never invents a category — "Uncategorized" is the honest fallback,
 * surfaced clearly in the UI so it can be fixed once (via the Swiggy
 * Categories admin page) and then it's remembered for every future import.
 */
/**
 * Persists a resolution result for any item name not already present in the
 * manual map — so "Uncategorized" and Zomato-bootstrapped items show up on
 * the Item → Category admin page (and get fixed once, not re-flagged on
 * every import). Exact/fuzzy matches are skipped since a doc already exists.
 */
export async function persistUnknownItemCategories(
  resolutions: { itemName: string; category: string; subCategory: string; source: CategoryMatchSource }[],
  existingMap: SwiggyItemCategory[],
  db: Firestore = defaultFirestore,
): Promise<void> {
  const known = new Set(existingMap.map((m) => m.itemName.trim().toLowerCase()));
  const seen = new Set<string>();
  for (const r of resolutions) {
    const key = r.itemName.trim().toLowerCase();
    if (known.has(key) || seen.has(key)) continue;
    seen.add(key);
    const id = slugifyItemName(r.itemName);
    await setDoc(doc(mapCol(db), id), {
      itemName: r.itemName.trim(),
      category: r.category,
      subCategory: r.subCategory,
      source: r.source === 'unmatched' ? ('unmapped' as const) : ('zomato_bootstrap' as const),
      updatedAt: serverTimestamp(),
    }, { merge: false });
  }
}

export function resolveSwiggyItemCategory(
  itemName: string,
  manualMap: SwiggyItemCategory[],
  zomatoBootstrapMap: Map<string, { category: string; subCategory: string }>,
): CategoryResolution {
  const normalized = itemName.trim().toLowerCase();

  const exact = manualMap.find((m) => m.itemName.trim().toLowerCase() === normalized);
  if (exact) return { category: exact.category, subCategory: exact.subCategory, source: 'exact' };

  const fuzzy = manualMap.find((m) => payeeTextsLooselyMatch(m.itemName, itemName));
  if (fuzzy) return { category: fuzzy.category, subCategory: fuzzy.subCategory, source: 'fuzzy' };

  const zomatoExact = zomatoBootstrapMap.get(normalized);
  if (zomatoExact) return { ...zomatoExact, source: 'zomato_bootstrap' };

  for (const [key, value] of zomatoBootstrapMap) {
    if (payeeTextsLooselyMatch(key, itemName)) return { ...value, source: 'zomato_bootstrap' };
  }

  return { category: 'Uncategorized', subCategory: '', source: 'unmatched' };
}
