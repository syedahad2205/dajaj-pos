/**
 * Swiggy Sales Tracker — Firestore service layer
 *
 * Mirrors services/zomatoService.ts as closely as the source data allows.
 * The one structural difference: Swiggy's "Past Orders" report has no
 * category column, so every item is resolved against the persistent
 * swiggy_item_categories map (services/swiggyCategoryMapService.ts) at
 * import time, before being grouped into category/item summaries.
 *
 * Collections:
 *   swiggy_imports          — one doc per CSV import
 *   swiggy_item_sales       — one row per (item × date) in the import
 *   swiggy_category_summary — pre-computed category totals per import
 *   swiggy_item_summary     — pre-computed item totals per import
 *
 * Settlement model (mirrors Zomato's, using Swiggy's own payout-card labels):
 *   - totalRevenue     → CSV-derived revenue (pre-GST item price, qty-multiplied)
 *                        — used as the allocation base for item/category share
 *   - totalCustomerPaid (A) → from the Swiggy payout card
 *   - netPayout             → actual payout received
 *   - totalDeductions = totalCustomerPaid − netPayout
 *   - deductionPct    = totalDeductions / totalCustomerPaid   ← NOT / csvRevenue
 *   - per-item/category deduction = csvRevenue × deductionPct
 *   - totalFees / complaintCancellationCharges / totalTaxes / adsSpend /
 *     otherChargesRefunds (B–F on the payout card) are stored for reference
 *     only — the deduction % is driven purely by totalCustomerPaid vs
 *     netPayout, so nothing needs to be modelled/estimated line by line.
 *
 * There is deliberately no Finance auto-posting step here yet (unlike
 * Zomato's zomatoFinanceService escrow reconciliation) — Swiggy revenue
 * currently gets recorded into Daily Closing / Finance manually. This module
 * is scoped to category-level revenue + payout settlement reporting.
 */

import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  Timestamp,
  writeBatch,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import { firestore as defaultFirestore } from '@/lib/firebase';
import type { ParsedSwiggyItem } from '@/lib/swiggyCsvParser';
import {
  ensureSwiggySeedCategories,
  getAllSwiggyItemCategories,
  getZomatoCategoryBootstrapMap,
  persistUnknownItemCategories,
  resolveSwiggyItemCategory,
  type CategoryMatchSource,
} from '@/services/swiggyCategoryMapService';
import { postSwiggySettlementToFinance } from '@/services/swiggyFinanceService';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SwiggyImportStatus = 'active' | 'deleted';

export interface SwiggyImport {
  id: string;
  fileName: string;
  importedAt: Timestamp;
  reportStartDate: string; // yyyy-MM-dd
  reportEndDate: string;   // yyyy-MM-dd
  /** CSV-derived revenue (pre-GST item price) — allocation base for per-item/category share */
  totalRevenue: number;
  totalQuantity: number;
  totalItems: number;
  ordersParsed: number;
  ordersSkipped: number;
  status: SwiggyImportStatus;
  overriddenImportId?: string;
  // ── Settlement fields (set after user enters values from the Swiggy payout card) ──
  /** (A) Total Customer Paid */
  totalCustomerPaid?: number;
  /** Actual payout received */
  netPayout?: number;
  /** totalCustomerPaid − netPayout */
  totalDeductions?: number;
  /** totalDeductions / totalCustomerPaid  (0–1 fraction) */
  deductionPct?: number;
  // ── Reference-only breakdown from the payout card (not used in the calc) ──
  totalFees?: number;
  complaintCancellationCharges?: number;
  totalTaxes?: number;
  adsSpend?: number;
  otherChargesRefunds?: number;
  // ── Finance reconciliation fields (set by services/swiggyFinanceService.ts
  // right after saveSwiggySettlement writes the fields above) ──
  /** Sum of Swiggy Escrow Income postings for [reportStartDate, reportEndDate] at the time of settlement */
  financeEscrowTotal?: number | null;
  /** financeEscrowTotal − netPayout */
  financeDifference?: number | null;
  financeTransferTransactionId?: string | null;
  financeAdjustmentTransactionId?: string | null;
  /** Non-fatal issues from the Finance posting attempt (e.g. a missing Finance Defaults mapping) — empty when everything posted cleanly */
  financePostingWarnings?: string[];
}

export interface SwiggyItemSale {
  id: string;
  importId: string;
  reportStartDate: string;
  reportEndDate: string;
  date: string;
  itemName: string;
  category: string;
  subCategory: string;
  categorySource: CategoryMatchSource;
  quantitySold: number;
  unitPrice: number;
  revenue: number;
}

export interface SwiggyCategorySummary {
  id: string;
  importId: string;
  category: string;
  totalRevenue: number;
  totalQuantity: number;
  allocatedDeduction?: number;
  netRevenue?: number;
}

export interface SwiggyItemSummary {
  id: string;
  importId: string;
  itemName: string;
  category: string;
  subCategory: string;
  categorySource: CategoryMatchSource;
  totalRevenue: number;
  totalQuantity: number;
  allocatedDeduction?: number;
  netRevenue?: number;
}

export interface SwiggySettlementReport {
  importId: string;
  csvRevenue: number;
  totalCustomerPaid: number;
  netPayout: number;
  totalDeductions: number;
  deductionPct: number;
  reconciliationDiff: number;
  categories: {
    category: string;
    qty: number;
    grossRevenue: number;
    allocatedDeduction: number;
    netRevenue: number;
    sharePct: number;
  }[];
  items: {
    itemName: string;
    category: string;
    subCategory: string;
    qty: number;
    grossRevenue: number;
    allocatedDeduction: number;
    netRevenue: number;
  }[];
}

// ── Item resolution (category attached before import) ─────────────────────────

export interface ResolvedSwiggyItem extends ParsedSwiggyItem {
  category: string;
  subCategory: string;
  categorySource: CategoryMatchSource;
}

/** Resolves category for every parsed item against the persistent map + Zomato bootstrap. Call once, before importSwiggyCsv. */
export async function resolveSwiggyItems(
  items: ParsedSwiggyItem[],
  db: Firestore = defaultFirestore,
): Promise<ResolvedSwiggyItem[]> {
  await ensureSwiggySeedCategories(db);
  const [manualMap, zomatoBootstrap] = await Promise.all([
    getAllSwiggyItemCategories(db),
    getZomatoCategoryBootstrapMap(db),
  ]);
  const resolvedItems: ResolvedSwiggyItem[] = items.map((item) => {
    const { category, subCategory, source } = resolveSwiggyItemCategory(item.itemName, manualMap, zomatoBootstrap);
    return { ...item, category, subCategory, categorySource: source };
  });

  // So "Uncategorized" and Zomato-bootstrapped items show up on the Item →
  // Category admin page immediately, instead of only after someone notices
  // them in an import preview.
  await persistUnknownItemCategories(
    resolvedItems.map((i) => ({ itemName: i.itemName, category: i.category, subCategory: i.subCategory, source: i.categorySource })),
    manualMap,
    db,
  );

  return resolvedItems;
}

// ── Collection helpers ────────────────────────────────────────────────────────

const importsCol = (db: Firestore) => collection(db, 'swiggy_imports');
const salesCol   = (db: Firestore) => collection(db, 'swiggy_item_sales');
const catSumCol  = (db: Firestore) => collection(db, 'swiggy_category_summary');
const itemSumCol = (db: Firestore) => collection(db, 'swiggy_item_summary');

async function commitInChunks(
  ops: Array<(batch: ReturnType<typeof writeBatch>) => void>,
  db: Firestore,
): Promise<void> {
  const CHUNK = 499;
  for (let i = 0; i < ops.length; i += CHUNK) {
    const batch = writeBatch(db);
    ops.slice(i, i + CHUNK).forEach((fn) => fn(batch));
    await batch.commit();
  }
}

// ── Date overlap detection ────────────────────────────────────────────────────

export interface OverlapResult {
  type: 'none' | 'exact' | 'partial';
  conflictingImports: SwiggyImport[];
}

export async function checkSwiggyDateOverlap(
  startDate: string,
  endDate: string,
  db: Firestore = defaultFirestore,
): Promise<OverlapResult> {
  const snap = await getDocs(query(importsCol(db), where('status', '==', 'active')));
  const active = snap.docs.map((d) => ({ id: d.id, ...d.data() } as SwiggyImport));
  const conflicting = active.filter(
    (imp) => startDate <= imp.reportEndDate && endDate >= imp.reportStartDate,
  );
  if (conflicting.length === 0) return { type: 'none', conflictingImports: [] };
  const isExact = conflicting.some(
    (imp) => imp.reportStartDate === startDate && imp.reportEndDate === endDate,
  );
  return { type: isExact ? 'exact' : 'partial', conflictingImports: conflicting };
}

// ── Delete helpers ────────────────────────────────────────────────────────────

export async function deleteSwiggyImportAndData(
  importId: string,
  db: Firestore = defaultFirestore,
): Promise<void> {
  await updateDoc(doc(importsCol(db), importId), { status: 'deleted' });
  const [salesSnap, catSnap, itemSnap] = await Promise.all([
    getDocs(query(salesCol(db),   where('importId', '==', importId))),
    getDocs(query(catSumCol(db),  where('importId', '==', importId))),
    getDocs(query(itemSumCol(db), where('importId', '==', importId))),
  ]);
  const ops = [
    ...salesSnap.docs.map((d) => (b: ReturnType<typeof writeBatch>) => b.delete(d.ref)),
    ...catSnap.docs.map((d)   => (b: ReturnType<typeof writeBatch>) => b.delete(d.ref)),
    ...itemSnap.docs.map((d)  => (b: ReturnType<typeof writeBatch>) => b.delete(d.ref)),
  ];
  if (ops.length > 0) await commitInChunks(ops, db);
}

export async function hardDeleteSwiggyImport(
  importId: string,
  db: Firestore = defaultFirestore,
): Promise<void> {
  const [salesSnap, catSnap, itemSnap] = await Promise.all([
    getDocs(query(salesCol(db),   where('importId', '==', importId))),
    getDocs(query(catSumCol(db),  where('importId', '==', importId))),
    getDocs(query(itemSumCol(db), where('importId', '==', importId))),
  ]);
  const ops: Array<(b: ReturnType<typeof writeBatch>) => void> = [
    (b) => b.delete(doc(importsCol(db), importId)),
    ...salesSnap.docs.map((d) => (b: ReturnType<typeof writeBatch>) => b.delete(d.ref)),
    ...catSnap.docs.map((d)   => (b: ReturnType<typeof writeBatch>) => b.delete(d.ref)),
    ...itemSnap.docs.map((d)  => (b: ReturnType<typeof writeBatch>) => b.delete(d.ref)),
  ];
  await commitInChunks(ops, db);
}

// ── Core import ───────────────────────────────────────────────────────────────

export interface ImportSwiggyCsvOptions {
  fileName: string;
  reportStartDate: string;
  reportEndDate: string;
  items: ResolvedSwiggyItem[];
  ordersParsed: number;
  ordersSkipped: number;
  overriddenImportId?: string;
  db?: Firestore;
}

export async function importSwiggyCsv({
  fileName,
  reportStartDate,
  reportEndDate,
  items,
  ordersParsed,
  ordersSkipped,
  overriddenImportId,
  db = defaultFirestore,
}: ImportSwiggyCsvOptions): Promise<SwiggyImport> {
  const totalRevenue  = Math.round(items.reduce((s, i) => s + i.revenue, 0) * 100) / 100;
  const totalQuantity = items.reduce((s, i) => s + i.quantity, 0);
  const totalItems    = new Set(items.map((i) => i.itemName)).size;

  const importRef = await addDoc(importsCol(db), {
    fileName,
    importedAt: serverTimestamp(),
    reportStartDate,
    reportEndDate,
    totalRevenue,
    totalQuantity,
    totalItems,
    ordersParsed,
    ordersSkipped,
    status: 'active' as SwiggyImportStatus,
    ...(overriddenImportId ? { overriddenImportId } : {}),
  });
  const importId = importRef.id;

  // Item sales — aggregated per (item name × date), same granularity as Zomato's parser output
  const salesMap = new Map<string, { category: string; subCategory: string; categorySource: CategoryMatchSource; date: string; qty: number; revenue: number }>();
  for (const item of items) {
    const key = `${item.itemName}|||${item.date}`;
    const cur = salesMap.get(key) ?? {
      category: item.category, subCategory: item.subCategory, categorySource: item.categorySource,
      date: item.date, qty: 0, revenue: 0,
    };
    salesMap.set(key, { ...cur, qty: cur.qty + item.quantity, revenue: cur.revenue + item.revenue });
  }

  const salesOps: Array<(b: ReturnType<typeof writeBatch>) => void> = [];
  for (const [key, agg] of salesMap) {
    const itemName = key.split('|||')[0];
    const ref = doc(salesCol(db));
    salesOps.push((b) => b.set(ref, {
      importId,
      reportStartDate,
      reportEndDate,
      date:           agg.date,
      itemName,
      category:       agg.category,
      subCategory:    agg.subCategory,
      categorySource: agg.categorySource,
      quantitySold:   agg.qty,
      unitPrice:      agg.qty > 0 ? Math.round((agg.revenue / agg.qty) * 100) / 100 : 0,
      revenue:        Math.round(agg.revenue * 100) / 100,
    }));
  }

  // Category summaries
  const catMap = new Map<string, { revenue: number; qty: number }>();
  for (const item of items) {
    const key = item.category || 'Uncategorized';
    const cur = catMap.get(key) ?? { revenue: 0, qty: 0 };
    catMap.set(key, { revenue: cur.revenue + item.revenue, qty: cur.qty + item.quantity });
  }
  const catOps: Array<(b: ReturnType<typeof writeBatch>) => void> = [];
  for (const [category, { revenue, qty }] of catMap) {
    const ref = doc(catSumCol(db));
    catOps.push((b) => b.set(ref, {
      importId, category,
      totalRevenue:  Math.round(revenue * 100) / 100,
      totalQuantity: qty,
    }));
  }

  // Item summaries
  const itemMap = new Map<string, { category: string; subCategory: string; categorySource: CategoryMatchSource; revenue: number; qty: number }>();
  for (const item of items) {
    const cur = itemMap.get(item.itemName) ?? {
      category: item.category, subCategory: item.subCategory, categorySource: item.categorySource, revenue: 0, qty: 0,
    };
    itemMap.set(item.itemName, { ...cur, revenue: cur.revenue + item.revenue, qty: cur.qty + item.quantity });
  }
  const itemOps: Array<(b: ReturnType<typeof writeBatch>) => void> = [];
  for (const [itemName, { category, subCategory, categorySource, revenue, qty }] of itemMap) {
    const ref = doc(itemSumCol(db));
    itemOps.push((b) => b.set(ref, {
      importId, itemName, category, subCategory, categorySource,
      totalRevenue:  Math.round(revenue * 100) / 100,
      totalQuantity: qty,
    }));
  }

  await commitInChunks([...salesOps, ...catOps, ...itemOps], db);

  return {
    id: importId, fileName,
    importedAt: Timestamp.now(),
    reportStartDate, reportEndDate,
    totalRevenue, totalQuantity, totalItems, ordersParsed, ordersSkipped,
    status: 'active',
    ...(overriddenImportId ? { overriddenImportId } : {}),
  };
}

// ── Settlement ────────────────────────────────────────────────────────────────

export interface SaveSwiggySettlementInput {
  importId: string;
  /** (A) Total Customer Paid, from the Swiggy payout card */
  totalCustomerPaid: number;
  /** Actual payout received */
  netPayout: number;
  /** Reference-only breakdown (B–F on the payout card) */
  totalFees?: number;
  complaintCancellationCharges?: number;
  totalTaxes?: number;
  adsSpend?: number;
  otherChargesRefunds?: number;
  db?: Firestore;
}

/**
 * Save settlement data from the Swiggy payout card.
 *
 * Calculates:
 *   totalDeductions = totalCustomerPaid − netPayout
 *   deductionPct    = totalDeductions / totalCustomerPaid
 *
 * Then distributes deductions proportionally across category/item summaries
 * using their CSV revenue as the allocation base:
 *   allocatedDeduction = csvRevenue × deductionPct
 *
 * This intentionally does NOT try to model commission/GST/ads/TDS
 * separately — Total Customer Paid vs Net Payout already captures every
 * deduction on the payout card, so the single ratio is both simpler and
 * more accurate than reconstructing each line item.
 *
 * Also posts the real cash movement to Finance (see
 * services/swiggyFinanceService.ts): a Transfer out of Swiggy Escrow for
 * `netPayout`, plus an Expense/Income for however much that differs from
 * the Escrow revenue already recognized for this import's covered dates.
 * That posting is best-effort — a missing Finance Defaults mapping (or any
 * other Finance-side issue) never blocks this settlement from saving; it's
 * just recorded as a warning on the import doc (`financePostingWarnings`)
 * for the UI to surface, and can be retried via a manual "Sync to Finance"
 * action once fixed.
 */
export async function saveSwiggySettlement({
  importId,
  totalCustomerPaid,
  netPayout,
  totalFees,
  complaintCancellationCharges,
  totalTaxes,
  adsSpend,
  otherChargesRefunds,
  db = defaultFirestore,
}: SaveSwiggySettlementInput): Promise<void> {
  if (totalCustomerPaid <= 0)          throw new Error('Total Customer Paid must be greater than zero.');
  if (netPayout < 0)                   throw new Error('Net Payout must be a positive amount.');
  if (netPayout > totalCustomerPaid)   throw new Error('Net Payout cannot exceed Total Customer Paid (A).');

  const importSnap = await getDoc(doc(importsCol(db), importId));
  if (!importSnap.exists()) throw new Error('Import not found.');

  const totalDeductions = Math.round((totalCustomerPaid - netPayout) * 1e10) / 1e10;
  const deductionPct    = totalDeductions / totalCustomerPaid;

  const [catSnap, itemSnap] = await Promise.all([
    getDocs(query(catSumCol(db),  where('importId', '==', importId))),
    getDocs(query(itemSumCol(db), where('importId', '==', importId))),
  ]);

  const ops: Array<(b: ReturnType<typeof writeBatch>) => void> = [];

  const referenceFields: Record<string, number> = {};
  if (totalFees !== undefined)                  referenceFields.totalFees = Math.round(totalFees * 100) / 100;
  if (complaintCancellationCharges !== undefined) referenceFields.complaintCancellationCharges = Math.round(complaintCancellationCharges * 100) / 100;
  if (totalTaxes !== undefined)                 referenceFields.totalTaxes = Math.round(totalTaxes * 100) / 100;
  if (adsSpend !== undefined)                   referenceFields.adsSpend = Math.round(adsSpend * 100) / 100;
  if (otherChargesRefunds !== undefined)         referenceFields.otherChargesRefunds = Math.round(otherChargesRefunds * 100) / 100;

  ops.push((b) => b.update(doc(importsCol(db), importId), {
    totalCustomerPaid: Math.round(totalCustomerPaid * 100) / 100,
    netPayout:          Math.round(netPayout * 100) / 100,
    totalDeductions:    Math.round(totalDeductions * 100) / 100,
    deductionPct,
    ...referenceFields,
  }));

  for (const d of catSnap.docs) {
    const rev      = (d.data().totalRevenue as number) ?? 0;
    const deduction = Math.round(rev * deductionPct * 100) / 100;
    ops.push((b) => b.update(d.ref, {
      allocatedDeduction: deduction,
      netRevenue:         Math.round((rev - deduction) * 100) / 100,
    }));
  }

  for (const d of itemSnap.docs) {
    const rev      = (d.data().totalRevenue as number) ?? 0;
    const deduction = Math.round(rev * deductionPct * 100) / 100;
    ops.push((b) => b.update(d.ref, {
      allocatedDeduction: deduction,
      netRevenue:         Math.round((rev - deduction) * 100) / 100,
    }));
  }

  await commitInChunks(ops, db);

  try {
    await postSwiggySettlementToFinance(importId, db);
  } catch (err) {
    // Should be rare — postSwiggySettlementToFinance already swallows most
    // failures into its own warnings field. If something still throws (e.g.
    // the import doc vanished between the two calls), don't let it undo the
    // settlement save above; just leave the finance* fields unset.
    console.error('[swiggyService] Failed to post settlement to Finance:', err);
  }
}

/** Load the full settlement report for a single import. Returns null if settlement not yet entered. */
export async function getSwiggySettlementReport(
  importId: string,
  db: Firestore = defaultFirestore,
): Promise<SwiggySettlementReport | null> {
  const [importSnap, catSnap, itemSnap] = await Promise.all([
    getDoc(doc(importsCol(db), importId)),
    getDocs(query(catSumCol(db),  where('importId', '==', importId))),
    getDocs(query(itemSumCol(db), where('importId', '==', importId))),
  ]);

  if (!importSnap.exists()) return null;

  const imp = { id: importSnap.id, ...importSnap.data() } as SwiggyImport;
  if (imp.totalCustomerPaid === undefined || imp.netPayout === undefined) return null;

  const csvRevenue         = imp.totalRevenue;
  const totalCustomerPaid  = imp.totalCustomerPaid;
  const netPayout          = imp.netPayout;
  const totalDeductions    = imp.totalDeductions ?? Math.round((totalCustomerPaid - netPayout) * 100) / 100;
  const deductionPct       = imp.deductionPct    ?? (totalCustomerPaid > 0 ? totalDeductions / totalCustomerPaid : 0);

  const categories = catSnap.docs
    .map((d) => {
      const data = d.data() as SwiggyCategorySummary;
      const rev  = data.totalRevenue;
      const ded  = data.allocatedDeduction ?? Math.round(rev * deductionPct * 100) / 100;
      return {
        category:           data.category,
        qty:                data.totalQuantity,
        grossRevenue:       rev,
        allocatedDeduction: ded,
        netRevenue:         data.netRevenue ?? Math.round((rev - ded) * 100) / 100,
        sharePct:           csvRevenue > 0 ? Math.round((rev / csvRevenue) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.grossRevenue - a.grossRevenue);

  const items = itemSnap.docs
    .map((d) => {
      const data = d.data() as SwiggyItemSummary;
      const rev  = data.totalRevenue;
      const ded  = data.allocatedDeduction ?? Math.round(rev * deductionPct * 100) / 100;
      return {
        itemName:           data.itemName,
        category:           data.category,
        subCategory:        data.subCategory,
        qty:                data.totalQuantity,
        grossRevenue:       rev,
        allocatedDeduction: ded,
        netRevenue:         data.netRevenue ?? Math.round((rev - ded) * 100) / 100,
      };
    })
    .sort((a, b) => b.grossRevenue - a.grossRevenue);

  return {
    importId,
    csvRevenue,
    totalCustomerPaid,
    netPayout,
    totalDeductions,
    deductionPct,
    reconciliationDiff: Math.round((totalCustomerPaid - csvRevenue) * 100) / 100,
    categories,
    items,
  };
}

// ── CSV export ────────────────────────────────────────────────────────────────

export function buildSwiggySettlementCsv(
  report: SwiggySettlementReport,
  importPeriod: string,
  categoryFilter?: string,
): string {
  const rows: string[] = [];

  rows.push('Swiggy Settlement Report');
  rows.push(`Period,${importPeriod}`);
  rows.push(`CSV Revenue,${report.csvRevenue.toFixed(2)}`);
  rows.push(`Total Customer Paid (A),${report.totalCustomerPaid.toFixed(2)}`);
  rows.push(`Reconciliation Diff,${report.reconciliationDiff >= 0 ? '+' : ''}${report.reconciliationDiff.toFixed(2)}`);
  rows.push(`Net Payout,${report.netPayout.toFixed(2)}`);
  rows.push(`Total Deductions,${report.totalDeductions.toFixed(2)}`);
  rows.push(`Deduction %,${(report.deductionPct * 100).toFixed(4)}%`);
  rows.push('');

  rows.push('Category Settlement');
  rows.push('Category,Qty Sold,CSV Revenue,Deduction,Net Revenue,Share %');
  const cats = categoryFilter
    ? report.categories.filter((c) => c.category === categoryFilter)
    : report.categories;
  for (const c of cats) {
    rows.push(
      `"${c.category}",${c.qty},${c.grossRevenue.toFixed(2)},` +
      `${c.allocatedDeduction.toFixed(2)},${c.netRevenue.toFixed(2)},${c.sharePct}%`,
    );
  }
  rows.push('');

  rows.push('Item Settlement');
  rows.push('Item Name,Category,Sub-Category,Qty Sold,CSV Revenue,Deduction,Net Revenue');
  const filteredItems = categoryFilter
    ? report.items.filter((i) => i.category === categoryFilter)
    : report.items;
  for (const i of filteredItems) {
    rows.push(
      `"${i.itemName}","${i.category}","${i.subCategory}",${i.qty},` +
      `${i.grossRevenue.toFixed(2)},${i.allocatedDeduction.toFixed(2)},${i.netRevenue.toFixed(2)}`,
    );
  }

  return rows.join('\n');
}

// ── Queries ───────────────────────────────────────────────────────────────────

export async function getSwiggyImports(
  db: Firestore = defaultFirestore,
): Promise<SwiggyImport[]> {
  const snap = await getDocs(query(importsCol(db), where('status', '==', 'active')));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as SwiggyImport))
    .sort((a, b) => b.reportStartDate.localeCompare(a.reportStartDate));
}

export async function getSwiggyImport(
  importId: string,
  db: Firestore = defaultFirestore,
): Promise<SwiggyImport | null> {
  const snap = await getDoc(doc(importsCol(db), importId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as SwiggyImport;
}

export async function getSwiggyItemSalesForImport(
  importId: string,
  db: Firestore = defaultFirestore,
): Promise<SwiggyItemSale[]> {
  const snap = await getDocs(query(salesCol(db), where('importId', '==', importId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as SwiggyItemSale));
}

export async function getSwiggyCategorySummaryForImport(
  importId: string,
  db: Firestore = defaultFirestore,
): Promise<SwiggyCategorySummary[]> {
  const snap = await getDocs(query(catSumCol(db), where('importId', '==', importId)));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as SwiggyCategorySummary))
    .sort((a, b) => b.totalRevenue - a.totalRevenue);
}

export async function getSwiggyItemSummaryForImport(
  importId: string,
  db: Firestore = defaultFirestore,
): Promise<SwiggyItemSummary[]> {
  const snap = await getDocs(query(itemSumCol(db), where('importId', '==', importId)));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as SwiggyItemSummary))
    .sort((a, b) => b.totalRevenue - a.totalRevenue);
}
