/**
 * Zomato Sales Tracker — Firestore service layer
 *
 * Collections:
 *   zomato_imports          — one doc per CSV import
 *   zomato_item_sales       — one row per (item × date) in the import
 *   zomato_category_summary — pre-computed category totals per import
 *   zomato_item_summary     — pre-computed item totals per import
 *
 * Settlement model:
 *   - totalRevenue  → CSV-derived revenue (used for item/category allocation share)
 *   - netOrderValue → Net Order Value (A) from the Zomato payout statement
 *   - finalPayout   → actual payout received
 *   - totalDeductions = netOrderValue − finalPayout
 *   - deductionPct    = totalDeductions / netOrderValue   ← NOT / csvRevenue
 *   - per-item/category deduction = csvRevenue × deductionPct
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
import type { ParsedZomatoItem } from '@/lib/zomatoCsvParser';
import { postZomatoSettlementToFinance } from '@/services/zomatoFinanceService';
export type { ParsedZomatoItem };

// ── Types ─────────────────────────────────────────────────────────────────────

export type ZomatoImportStatus = 'active' | 'deleted';

export interface ZomatoImport {
  id: string;
  fileName: string;
  importedAt: Timestamp;
  reportStartDate: string; // yyyy-MM-dd
  reportEndDate: string;   // yyyy-MM-dd
  /** CSV-derived revenue (used as allocation base for per-item/category share) */
  totalRevenue: number;
  totalQuantity: number;
  totalItems: number;
  status: ZomatoImportStatus;
  overriddenImportId?: string;
  // ── Settlement fields (set after user enters Zomato payout statement values) ──
  /** Net Order Value (A) from the Zomato payout statement — the true settlement base */
  netOrderValue?: number;
  /** Actual payout received */
  finalPayout?: number;
  /** netOrderValue − finalPayout */
  totalDeductions?: number;
  /** totalDeductions / netOrderValue  (0–1 fraction) */
  deductionPct?: number;
  // ── Finance reconciliation fields (set by services/zomatoFinanceService.ts
  // right after saveSettlement writes the fields above) ──
  /** Sum of Zomato Escrow Income postings for [reportStartDate, reportEndDate] at the time of settlement */
  financeEscrowTotal?: number | null;
  /** financeEscrowTotal − finalPayout */
  financeDifference?: number | null;
  financeTransferTransactionId?: string | null;
  financeAdjustmentTransactionId?: string | null;
  /** Non-fatal issues from the Finance posting attempt (e.g. a missing Finance Defaults mapping) — empty when everything posted cleanly */
  financePostingWarnings?: string[];
}

export interface ZomatoItemSale {
  id: string;
  importId: string;
  reportStartDate: string;
  reportEndDate: string;
  date: string;
  itemName: string;
  category: string;
  subCategory: string;
  quantitySold: number;
  unitPrice: number;
  revenue: number;
}

export interface ZomatoCategorySummary {
  id: string;
  importId: string;
  category: string;
  totalRevenue: number;
  totalQuantity: number;
  // Settlement (populated after saveSettlement)
  allocatedDeduction?: number;
  netRevenue?: number;
}

export interface ZomatoItemSummary {
  id: string;
  importId: string;
  itemName: string;
  category: string;
  subCategory: string;
  totalRevenue: number;
  totalQuantity: number;
  // Settlement
  allocatedDeduction?: number;
  netRevenue?: number;
}

// ── Settlement report shape ───────────────────────────────────────────────────

export interface SettlementReport {
  importId: string;
  /** Revenue from CSV import */
  csvRevenue: number;
  /** Net Order Value (A) from Zomato payout statement — settlement base */
  netOrderValue: number;
  finalPayout: number;
  /** netOrderValue − finalPayout */
  totalDeductions: number;
  /** totalDeductions / netOrderValue */
  deductionPct: number;
  /** netOrderValue − csvRevenue  (positive = NOV > CSV) */
  reconciliationDiff: number;
  categories: {
    category: string;
    qty: number;
    /** CSV revenue for this category */
    grossRevenue: number;
    /** grossRevenue × deductionPct */
    allocatedDeduction: number;
    netRevenue: number;
    /** category share of total CSV revenue */
    sharePct: number;
  }[];
  items: {
    itemName: string;
    category: string;
    subCategory: string;
    qty: number;
    /** CSV revenue for this item */
    grossRevenue: number;
    allocatedDeduction: number;
    netRevenue: number;
  }[];
}

// ── Collection helpers ────────────────────────────────────────────────────────

const importsCol = (db: Firestore) => collection(db, 'zomato_imports');
const salesCol   = (db: Firestore) => collection(db, 'zomato_item_sales');
const catSumCol  = (db: Firestore) => collection(db, 'zomato_category_summary');
const itemSumCol = (db: Firestore) => collection(db, 'zomato_item_summary');

// ── Batch write helper (chunks at 499 ops) ────────────────────────────────────

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
  conflictingImports: ZomatoImport[];
}

export async function checkDateOverlap(
  startDate: string,
  endDate: string,
  db: Firestore = defaultFirestore,
): Promise<OverlapResult> {
  const snap = await getDocs(
    query(importsCol(db), where('status', '==', 'active')),
  );
  const active = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ZomatoImport));
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

export async function deleteImportAndData(
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

export async function hardDeleteImport(
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

export interface ImportZomatoCsvOptions {
  fileName: string;
  reportStartDate: string;
  reportEndDate: string;
  items: ParsedZomatoItem[];
  overriddenImportId?: string;
  db?: Firestore;
}

export async function importZomatoCsv({
  fileName,
  reportStartDate,
  reportEndDate,
  items,
  overriddenImportId,
  db = defaultFirestore,
}: ImportZomatoCsvOptions): Promise<ZomatoImport> {
  const totalRevenue  = Math.round(items.reduce((s, i) => s + i.revenue, 0) * 100) / 100;
  const totalQuantity = items.reduce((s, i) => s + i.quantitySold, 0);
  const totalItems    = new Set(items.map((i) => i.itemName)).size;

  const importRef = await addDoc(importsCol(db), {
    fileName,
    importedAt: serverTimestamp(),
    reportStartDate,
    reportEndDate,
    totalRevenue,
    totalQuantity,
    totalItems,
    status: 'active' as ZomatoImportStatus,
    ...(overriddenImportId ? { overriddenImportId } : {}),
  });
  const importId = importRef.id;

  // Item sales (one per item × date)
  const salesOps: Array<(b: ReturnType<typeof writeBatch>) => void> = items.map((item) => {
    const ref = doc(salesCol(db));
    return (b) => b.set(ref, {
      importId,
      reportStartDate,
      reportEndDate,
      date:         item.date ?? reportStartDate,
      itemName:     item.itemName,
      category:     item.category,
      subCategory:  item.subCategory,
      quantitySold: item.quantitySold,
      unitPrice:    item.unitPrice,
      revenue:      item.revenue,
    });
  });

  // Category summaries
  const catMap = new Map<string, { revenue: number; qty: number }>();
  for (const item of items) {
    const key = item.category || 'Uncategorized';
    const cur = catMap.get(key) ?? { revenue: 0, qty: 0 };
    catMap.set(key, { revenue: cur.revenue + item.revenue, qty: cur.qty + item.quantitySold });
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
  const itemMap = new Map<string, { category: string; subCategory: string; revenue: number; qty: number }>();
  for (const item of items) {
    const cur = itemMap.get(item.itemName) ?? {
      category: item.category, subCategory: item.subCategory, revenue: 0, qty: 0,
    };
    itemMap.set(item.itemName, { ...cur, revenue: cur.revenue + item.revenue, qty: cur.qty + item.quantitySold });
  }
  const itemOps: Array<(b: ReturnType<typeof writeBatch>) => void> = [];
  for (const [itemName, { category, subCategory, revenue, qty }] of itemMap) {
    const ref = doc(itemSumCol(db));
    itemOps.push((b) => b.set(ref, {
      importId, itemName, category, subCategory,
      totalRevenue:  Math.round(revenue * 100) / 100,
      totalQuantity: qty,
    }));
  }

  await commitInChunks([...salesOps, ...catOps, ...itemOps], db);

  return {
    id: importId, fileName,
    importedAt: Timestamp.now(),
    reportStartDate, reportEndDate,
    totalRevenue, totalQuantity, totalItems,
    status: 'active',
    ...(overriddenImportId ? { overriddenImportId } : {}),
  };
}

// ── Settlement ────────────────────────────────────────────────────────────────

/**
 * Save settlement data from the Zomato payout statement.
 *
 * @param importId     - the Firestore document ID of the import
 * @param netOrderValue - Net Order Value (A) from the Zomato payout statement
 * @param finalPayout  - actual payout received
 *
 * Calculates:
 *   totalDeductions = netOrderValue − finalPayout
 *   deductionPct    = totalDeductions / netOrderValue
 *
 * Then distributes deductions proportionally across category/item summaries
 * using their CSV revenue as the allocation base:
 *   allocatedDeduction = csvRevenue × deductionPct
 *
 * All values stored once — nothing recalculated on every read.
 *
 * Also posts the real cash movement to Finance (see
 * services/zomatoFinanceService.ts): a Transfer out of Zomato Escrow for
 * `finalPayout`, plus an Expense/Income for however much that differs from
 * the Escrow revenue already recognized for this import's covered dates.
 * That posting is best-effort — a missing Finance Defaults mapping (or any
 * other Finance-side issue) never blocks this settlement from saving; it's
 * just recorded as a warning on the import doc (`financePostingWarnings`)
 * for the UI to surface, and can be retried via a manual "Sync to Finance"
 * action once fixed.
 */
export async function saveSettlement(
  importId: string,
  netOrderValue: number,
  finalPayout: number,
  db: Firestore = defaultFirestore,
): Promise<void> {
  if (netOrderValue <= 0)          throw new Error('Net Order Value must be greater than zero.');
  if (finalPayout < 0)             throw new Error('Final Payout must be a positive amount.');
  if (finalPayout > netOrderValue) throw new Error('Final Payout cannot exceed Net Order Value (A).');

  const importSnap = await getDoc(doc(importsCol(db), importId));
  if (!importSnap.exists()) throw new Error('Import not found.');

  const totalDeductions = Math.round((netOrderValue - finalPayout) * 1e10) / 1e10;
  const deductionPct    = totalDeductions / netOrderValue; // full precision stored

  const [catSnap, itemSnap] = await Promise.all([
    getDocs(query(catSumCol(db),  where('importId', '==', importId))),
    getDocs(query(itemSumCol(db), where('importId', '==', importId))),
  ]);

  const ops: Array<(b: ReturnType<typeof writeBatch>) => void> = [];

  // Update import doc
  ops.push((b) => b.update(doc(importsCol(db), importId), {
    netOrderValue:  Math.round(netOrderValue * 100) / 100,
    finalPayout:    Math.round(finalPayout   * 100) / 100,
    totalDeductions: Math.round(totalDeductions * 100) / 100,
    deductionPct,   // stored at full precision for accurate downstream allocation
  }));

  // Update each category summary
  for (const d of catSnap.docs) {
    const rev      = (d.data().totalRevenue as number) ?? 0;
    const deduction = Math.round(rev * deductionPct * 100) / 100;
    ops.push((b) => b.update(d.ref, {
      allocatedDeduction: deduction,
      netRevenue:         Math.round((rev - deduction) * 100) / 100,
    }));
  }

  // Update each item summary
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
    await postZomatoSettlementToFinance(importId, db);
  } catch (err) {
    // Should be rare — postZomatoSettlementToFinance already swallows most
    // failures into its own warnings field. If something still throws (e.g.
    // the import doc vanished between the two calls), don't let it undo the
    // settlement save above; just leave the finance* fields unset.
    console.error('[zomatoService] Failed to post settlement to Finance:', err);
  }
}

/** Load the full settlement report for a single import. Returns null if settlement not yet entered. */
export async function getSettlementReport(
  importId: string,
  db: Firestore = defaultFirestore,
): Promise<SettlementReport | null> {
  const [importSnap, catSnap, itemSnap] = await Promise.all([
    getDoc(doc(importsCol(db), importId)),
    getDocs(query(catSumCol(db),  where('importId', '==', importId))),
    getDocs(query(itemSumCol(db), where('importId', '==', importId))),
  ]);

  if (!importSnap.exists()) return null;

  const imp = { id: importSnap.id, ...importSnap.data() } as ZomatoImport;
  // Require both netOrderValue AND finalPayout to show a settlement report.
  // Legacy imports that only have finalPayout (no netOrderValue) are treated
  // as incomplete — the UI will prompt the user to re-enter both values.
  if (imp.netOrderValue === undefined || imp.finalPayout === undefined) return null;

  const csvRevenue      = imp.totalRevenue;
  const netOrderValue   = imp.netOrderValue;
  const finalPayout     = imp.finalPayout;
  const totalDeductions = imp.totalDeductions ?? Math.round((netOrderValue - finalPayout) * 100) / 100;
  const deductionPct    = imp.deductionPct    ?? (netOrderValue > 0 ? totalDeductions / netOrderValue : 0);

  const categories = catSnap.docs
    .map((d) => {
      const data = d.data() as ZomatoCategorySummary;
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
      const data = d.data() as ZomatoItemSummary;
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
    netOrderValue,
    finalPayout,
    totalDeductions,
    deductionPct,
    reconciliationDiff: Math.round((netOrderValue - csvRevenue) * 100) / 100,
    categories,
    items,
  };
}

// ── CSV export ────────────────────────────────────────────────────────────────

export function buildSettlementCsv(
  report: SettlementReport,
  importPeriod: string,
  categoryFilter?: string,
): string {
  const rows: string[] = [];

  rows.push('Zomato Settlement Report');
  rows.push(`Period,${importPeriod}`);
  rows.push(`CSV Revenue,${report.csvRevenue.toFixed(2)}`);
  rows.push(`Net Order Value (A),${report.netOrderValue.toFixed(2)}`);
  rows.push(`Reconciliation Diff,${report.reconciliationDiff >= 0 ? '+' : ''}${report.reconciliationDiff.toFixed(2)}`);
  rows.push(`Final Payout,${report.finalPayout.toFixed(2)}`);
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

export async function getZomatoImports(
  db: Firestore = defaultFirestore,
): Promise<ZomatoImport[]> {
  const snap = await getDocs(
    query(importsCol(db), where('status', '==', 'active')),
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as ZomatoImport))
    .sort((a, b) => b.reportStartDate.localeCompare(a.reportStartDate));
}

export async function getZomatoImport(
  importId: string,
  db: Firestore = defaultFirestore,
): Promise<ZomatoImport | null> {
  const snap = await getDoc(doc(importsCol(db), importId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as ZomatoImport;
}

export async function getItemSalesForImport(
  importId: string,
  db: Firestore = defaultFirestore,
): Promise<ZomatoItemSale[]> {
  const snap = await getDocs(query(salesCol(db), where('importId', '==', importId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ZomatoItemSale));
}

export async function getCategorySummaryForImport(
  importId: string,
  db: Firestore = defaultFirestore,
): Promise<ZomatoCategorySummary[]> {
  const snap = await getDocs(query(catSumCol(db), where('importId', '==', importId)));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as ZomatoCategorySummary))
    .sort((a, b) => b.totalRevenue - a.totalRevenue);
}

export async function getItemSummaryForImport(
  importId: string,
  db: Firestore = defaultFirestore,
): Promise<ZomatoItemSummary[]> {
  const snap = await getDocs(query(itemSumCol(db), where('importId', '==', importId)));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as ZomatoItemSummary))
    .sort((a, b) => b.totalRevenue - a.totalRevenue);
}

// ── Aggregated analytics (cross-import) ──────────────────────────────────────

export interface AggregatedAnalytics {
  /** Sum of CSV revenues */
  totalRevenue: number;
  totalQuantity: number;
  // Settlement — only populated when ALL selected imports have full settlement data
  hasSettlement: boolean;
  /** Sum of Net Order Values */
  totalNetOrderValue?: number;
  totalFinalPayout?: number;
  totalDeductions?: number;
  /** totalDeductions / totalNetOrderValue */
  overallDeductionPct?: number;
  categories: {
    category: string;
    revenue: number;
    qty: number;
    pct: number;
    allocatedDeduction?: number;
    netRevenue?: number;
  }[];
  items: {
    itemName: string;
    category: string;
    revenue: number;
    qty: number;
    allocatedDeduction?: number;
    netRevenue?: number;
  }[];
  revenueByPeriod: { label: string; revenue: number; startDate: string }[];
}

export async function getAggregatedAnalytics(
  importIds: string[],
  db: Firestore = defaultFirestore,
): Promise<AggregatedAnalytics> {
  if (importIds.length === 0) {
    return {
      totalRevenue: 0, totalQuantity: 0, hasSettlement: false,
      categories: [], items: [], revenueByPeriod: [],
    };
  }

  // Fetch import docs to get netOrderValue / finalPayout for settlement aggregation
  const importSnaps = await Promise.all(importIds.map((id) => getDoc(doc(importsCol(db), id))));
  const importDocs = importSnaps
    .filter((s) => s.exists())
    .map((s) => ({ id: s.id, ...s.data() } as ZomatoImport));

  // Check if all imports have full settlement (netOrderValue + finalPayout)
  const allSettled = importDocs.length > 0 &&
    importDocs.every((imp) => imp.netOrderValue !== undefined && imp.finalPayout !== undefined);

  const CHUNK = 30;
  const catRows: ZomatoCategorySummary[] = [];
  const itemRows: ZomatoItemSummary[]    = [];

  for (let i = 0; i < importIds.length; i += CHUNK) {
    const chunk = importIds.slice(i, i + CHUNK);
    const [cSnap, iSnap] = await Promise.all([
      getDocs(query(catSumCol(db),  where('importId', 'in', chunk))),
      getDocs(query(itemSumCol(db), where('importId', 'in', chunk))),
    ]);
    cSnap.docs.forEach((d) => catRows.push({ id: d.id, ...d.data() } as ZomatoCategorySummary));
    iSnap.docs.forEach((d) => itemRows.push({ id: d.id, ...d.data() } as ZomatoItemSummary));
  }

  // Aggregate categories
  const catMap = new Map<string, { revenue: number; qty: number; deduction: number; hasDeduction: boolean }>();
  for (const r of catRows) {
    const cur = catMap.get(r.category) ?? { revenue: 0, qty: 0, deduction: 0, hasDeduction: true };
    catMap.set(r.category, {
      revenue:      cur.revenue + r.totalRevenue,
      qty:          cur.qty    + r.totalQuantity,
      deduction:    cur.deduction + (r.allocatedDeduction ?? 0),
      hasDeduction: cur.hasDeduction && r.allocatedDeduction !== undefined,
    });
  }

  // Aggregate items
  const itemMap = new Map<string, { category: string; revenue: number; qty: number; deduction: number; hasDeduction: boolean }>();
  for (const r of itemRows) {
    const cur = itemMap.get(r.itemName) ?? { category: r.category, revenue: 0, qty: 0, deduction: 0, hasDeduction: true };
    itemMap.set(r.itemName, {
      category:     r.category,
      revenue:      cur.revenue   + r.totalRevenue,
      qty:          cur.qty       + r.totalQuantity,
      deduction:    cur.deduction + (r.allocatedDeduction ?? 0),
      hasDeduction: cur.hasDeduction && r.allocatedDeduction !== undefined,
    });
  }

  const totalRevenue  = Array.from(catMap.values()).reduce((s, c) => s + c.revenue, 0);
  const totalQuantity = Array.from(catMap.values()).reduce((s, c) => s + c.qty,     0);

  const categories = Array.from(catMap.entries())
    .map(([category, { revenue, qty, deduction, hasDeduction }]) => ({
      category,
      revenue,
      qty,
      pct: totalRevenue > 0 ? Math.round((revenue / totalRevenue) * 1000) / 10 : 0,
      ...(hasDeduction ? {
        allocatedDeduction: Math.round(deduction * 100) / 100,
        netRevenue:         Math.round((revenue - deduction) * 100) / 100,
      } : {}),
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const items = Array.from(itemMap.entries())
    .map(([itemName, { category, revenue, qty, deduction, hasDeduction }]) => ({
      itemName, category, revenue, qty,
      ...(hasDeduction ? {
        allocatedDeduction: Math.round(deduction * 100) / 100,
        netRevenue:         Math.round((revenue - deduction) * 100) / 100,
      } : {}),
    }))
    .sort((a, b) => b.revenue - a.revenue);

  // Settlement aggregates — derived from import docs (netOrderValue / finalPayout)
  let totalNetOrderValue: number | undefined;
  let totalFinalPayout: number | undefined;
  let totalDeductions: number | undefined;
  let overallDeductionPct: number | undefined;

  if (allSettled) {
    totalNetOrderValue = Math.round(
      importDocs.reduce((s, imp) => s + (imp.netOrderValue ?? 0), 0) * 100,
    ) / 100;
    totalFinalPayout = Math.round(
      importDocs.reduce((s, imp) => s + (imp.finalPayout ?? 0), 0) * 100,
    ) / 100;
    totalDeductions = Math.round((totalNetOrderValue - totalFinalPayout) * 100) / 100;
    overallDeductionPct = totalNetOrderValue > 0 ? totalDeductions / totalNetOrderValue : 0;
  }

  return {
    totalRevenue,
    totalQuantity,
    hasSettlement: allSettled,
    totalNetOrderValue,
    totalFinalPayout,
    totalDeductions,
    overallDeductionPct,
    categories,
    items,
    revenueByPeriod: [],
  };
}

// ── Recalculate analytics ─────────────────────────────────────────────────────

export async function recalculateAnalytics(
  importId: string,
  db: Firestore = defaultFirestore,
): Promise<void> {
  const [salesSnap, catSnap, itemSnap, importSnap] = await Promise.all([
    getDocs(query(salesCol(db),   where('importId', '==', importId))),
    getDocs(query(catSumCol(db),  where('importId', '==', importId))),
    getDocs(query(itemSumCol(db), where('importId', '==', importId))),
    getDoc(doc(importsCol(db), importId)),
  ]);

  const items = salesSnap.docs.map((d) => d.data() as Omit<ZomatoItemSale, 'id'>);
  const imp   = importSnap.exists() ? (importSnap.data() as ZomatoImport) : null;

  // Use stored deductionPct (derived from netOrderValue, not csvRevenue)
  const deductionPct = imp?.deductionPct;

  const deleteOps = [
    ...catSnap.docs.map((d)  => (b: ReturnType<typeof writeBatch>) => b.delete(d.ref)),
    ...itemSnap.docs.map((d) => (b: ReturnType<typeof writeBatch>) => b.delete(d.ref)),
  ];

  const catMap = new Map<string, { revenue: number; qty: number }>();
  for (const item of items) {
    const key = item.category || 'Uncategorized';
    const cur = catMap.get(key) ?? { revenue: 0, qty: 0 };
    catMap.set(key, { revenue: cur.revenue + item.revenue, qty: cur.qty + item.quantitySold });
  }

  const catOps: Array<(b: ReturnType<typeof writeBatch>) => void> = [];
  for (const [category, { revenue, qty }] of catMap) {
    const ref = doc(catSumCol(db));
    const settlement = deductionPct !== undefined ? {
      allocatedDeduction: Math.round(revenue * deductionPct * 100) / 100,
      netRevenue:         Math.round(revenue * (1 - deductionPct) * 100) / 100,
    } : {};
    catOps.push((b) => b.set(ref, {
      importId, category,
      totalRevenue:  Math.round(revenue * 100) / 100,
      totalQuantity: qty,
      ...settlement,
    }));
  }

  const itemMap = new Map<string, { category: string; subCategory: string; revenue: number; qty: number }>();
  for (const item of items) {
    const cur = itemMap.get(item.itemName) ?? {
      category: item.category, subCategory: item.subCategory, revenue: 0, qty: 0,
    };
    itemMap.set(item.itemName, { ...cur, revenue: cur.revenue + item.revenue, qty: cur.qty + item.quantitySold });
  }

  const itemOps: Array<(b: ReturnType<typeof writeBatch>) => void> = [];
  for (const [itemName, { category, subCategory, revenue, qty }] of itemMap) {
    const ref = doc(itemSumCol(db));
    const settlement = deductionPct !== undefined ? {
      allocatedDeduction: Math.round(revenue * deductionPct * 100) / 100,
      netRevenue:         Math.round(revenue * (1 - deductionPct) * 100) / 100,
    } : {};
    itemOps.push((b) => b.set(ref, {
      importId, itemName, category, subCategory,
      totalRevenue:  Math.round(revenue * 100) / 100,
      totalQuantity: qty,
      ...settlement,
    }));
  }

  const newCsvRevenue = Math.round(items.reduce((s, i) => s + i.revenue, 0) * 100) / 100;
  const totalQuantity = items.reduce((s, i) => s + i.quantitySold, 0);
  const totalItems    = new Set(items.map((i) => i.itemName)).size;

  // Recompute settlement totals from netOrderValue (unchanged) and stored finalPayout
  const settlementUpdate: Record<string, number> = { totalRevenue: newCsvRevenue };
  if (imp?.netOrderValue !== undefined && imp.finalPayout !== undefined) {
    const td = Math.round((imp.netOrderValue - imp.finalPayout) * 100) / 100;
    settlementUpdate.totalDeductions = td;
    settlementUpdate.deductionPct    = imp.netOrderValue > 0 ? td / imp.netOrderValue : 0;
  }

  await updateDoc(doc(importsCol(db), importId), { ...settlementUpdate, totalQuantity, totalItems });
  await commitInChunks([...deleteOps, ...catOps, ...itemOps], db);
}
