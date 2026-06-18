/**
 * Zomato Item Sales Report CSV Parser — Daily Report (pivot/wide format)
 *
 * Actual CSV structure (from Zomato):
 *   Row 0 (header):
 *     Restaurant ID | Restaurant name | Subzone | City | Item name |
 *     Item category | Item subcategory | Metric | <date1> | <date2> | … | <dateN>
 *
 *   Rows 1-N (data, 5 rows per item):
 *     …same fixed cols… | Item quantity sold     | qty_d1 | qty_d2 | …
 *     …same fixed cols… | Unit cost of item (₹)  | cost_d1| cost_d2| …
 *     …same fixed cols… | Orders with item        | (ignored)
 *     …same fixed cols… | Item quantity per order | (ignored)
 *     …same fixed cols… | Item rating             | (ignored)
 *
 * One output record is produced per (item, date) pair where qty > 0.
 * Revenue = quantitySold * unitCost for that specific date.
 */

export interface ParsedZomatoItem {
  itemName: string;
  category: string;
  subCategory: string;
  /** ISO date yyyy-MM-dd for this specific day */
  date: string;
  quantitySold: number;
  unitPrice: number;
  revenue: number;
}

export interface ZomatoCsvParseResult {
  items: ParsedZomatoItem[];
  /** ISO date string yyyy-MM-dd of the first date column */
  reportStartDate: string | null;
  /** ISO date string yyyy-MM-dd of the last date column */
  reportEndDate: string | null;
  errors: string[];
}

// ── Date parsing ──────────────────────────────────────────────────────────────

const MONTH_MAP: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Parse date column headers like "8 Jun 2026", "14 Jun, 2026", "2026-06-08"
 * Returns ISO yyyy-MM-dd or null.
 */
function parseDateHeader(raw: string): string | null {
  const s = raw.trim().replace(/,/g, '');

  // ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // "8 Jun 2026" or "08 Jun 2026"
  const m = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (m) {
    const month = MONTH_MAP[m[2].toLowerCase().slice(0, 3)];
    if (month !== undefined) {
      return `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
  }

  // "Jun 8 2026"
  const m2 = s.match(/^([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})$/);
  if (m2) {
    const month = MONTH_MAP[m2[1].toLowerCase().slice(0, 3)];
    if (month !== undefined) {
      return `${m2[3]}-${String(month + 1).padStart(2, '0')}-${m2[2].padStart(2, '0')}`;
    }
  }

  return null;
}

// ── Column indices (fixed) ────────────────────────────────────────────────────

const COL_ITEM_NAME    = 4;
const COL_CATEGORY     = 5;
const COL_SUBCATEGORY  = 6;
const COL_METRIC       = 7;
const COL_DATES_START  = 8;

// Metric identifiers (case-insensitive match)
const METRIC_QTY  = 'item quantity sold';
const METRIC_COST = 'unit cost of item';

function matchMetric(raw: string, target: string): boolean {
  return raw.toLowerCase().trim().startsWith(target);
}

// ── CSV tokeniser ─────────────────────────────────────────────────────────────

function parseCsvRow(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let inQuote = false;
  let field = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; }
        else inQuote = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
      } else if (ch === delimiter) {
        fields.push(field.trim());
        field = '';
      } else {
        field += ch;
      }
    }
  }
  fields.push(field.trim());
  return fields;
}

function detectDelimiter(line: string): string {
  return (line.match(/\t/g) || []).length > (line.match(/,/g) || []).length ? '\t' : ',';
}

// ── Main export ───────────────────────────────────────────────────────────────

export function parseZomatoCsv(csvText: string): ZomatoCsvParseResult {
  const errors: string[] = [];

  // Strip BOM
  const clean = csvText.replace(/^﻿/, '');
  const rawLines = clean.split(/\r?\n/).filter((l) => l.trim() !== '');

  if (rawLines.length < 2) {
    return { items: [], reportStartDate: null, reportEndDate: null, errors: ['CSV appears to be empty.'] };
  }

  const delimiter = detectDelimiter(rawLines[0]);
  const headerFields = parseCsvRow(rawLines[0], delimiter);

  // Validate header structure
  if (headerFields.length < COL_DATES_START + 1) {
    errors.push(`Header row has only ${headerFields.length} columns — expected at least ${COL_DATES_START + 1}. Is this a Zomato Daily Item Sales Report?`);
    return { items: [], reportStartDate: null, reportEndDate: null, errors };
  }

  // Extract date columns
  const dateCols: { index: number; iso: string }[] = [];
  for (let i = COL_DATES_START; i < headerFields.length; i++) {
    const iso = parseDateHeader(headerFields[i]);
    if (iso) dateCols.push({ index: i, iso });
  }

  if (dateCols.length === 0) {
    errors.push('No date columns found in the header. Expected columns like "8 Jun 2026".');
    return { items: [], reportStartDate: null, reportEndDate: null, errors };
  }

  const reportStartDate = dateCols[0].iso;
  const reportEndDate   = dateCols[dateCols.length - 1].iso;

  // ── Group data rows by item key ───────────────────────────────────────────

  // key = "ItemName|||Category|||SubCategory"
  const itemGroups = new Map<
    string,
    { qtyRow: string[] | null; costRow: string[] | null }
  >();

  for (let i = 1; i < rawLines.length; i++) {
    const fields = parseCsvRow(rawLines[i], delimiter);
    if (fields.length < COL_METRIC + 1) continue;

    const itemName   = fields[COL_ITEM_NAME]?.trim()   ?? '';
    const category   = fields[COL_CATEGORY]?.trim()    ?? '';
    const subCat     = fields[COL_SUBCATEGORY]?.trim() ?? '';
    const metric     = fields[COL_METRIC]?.trim()      ?? '';

    if (!itemName) continue;

    const key = `${itemName}|||${category}|||${subCat}`;
    if (!itemGroups.has(key)) {
      itemGroups.set(key, { qtyRow: null, costRow: null });
    }

    const group = itemGroups.get(key)!;
    if (matchMetric(metric, METRIC_QTY)) {
      group.qtyRow = fields;
    } else if (matchMetric(metric, METRIC_COST)) {
      group.costRow = fields;
    }
  }

  if (itemGroups.size === 0) {
    errors.push('No item rows found. Verify this is a Zomato Daily Item Sales Report.');
    return { items: [], reportStartDate, reportEndDate, errors };
  }

  // ── Build per-date records ────────────────────────────────────────────────

  const items: ParsedZomatoItem[] = [];

  for (const [key, { qtyRow, costRow }] of itemGroups) {
    if (!qtyRow) continue; // need at least quantity row

    const [itemName, category, subCategory] = key.split('|||');

    for (const { index, iso } of dateCols) {
      const qtyRaw  = qtyRow[index]  ?? '-';
      const costRaw = costRow?.[index] ?? '-';

      // '-' means no sales on that day
      if (qtyRaw === '-' || qtyRaw === '') continue;

      const qty  = parseFloat(qtyRaw);
      const cost = costRaw === '-' || costRaw === '' ? 0 : parseFloat(costRaw);

      if (!isFinite(qty) || qty <= 0) continue;

      items.push({
        itemName,
        category,
        subCategory,
        date: iso,
        quantitySold: qty,
        unitPrice:    isFinite(cost) ? cost : 0,
        revenue:      Math.round(qty * (isFinite(cost) ? cost : 0) * 100) / 100,
      });
    }
  }

  if (items.length === 0) {
    errors.push('No sales data found (all quantities are "-"). The report period may have no orders.');
  }

  return { items, reportStartDate, reportEndDate, errors };
}
