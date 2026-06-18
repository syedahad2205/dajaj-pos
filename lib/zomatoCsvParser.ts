/**
 * Zomato Item Sales Report CSV Parser
 *
 * Handles the standard Zomato Item Sales Report format:
 *   Row 0: Restaurant name / report title
 *   Row 1: Date range  (e.g. "08 Jun, 2025 - 14 Jun, 2025")
 *   Row 2: (empty or sub-header)
 *   Row 3: Column headers — "Item name", "Category", "Sub category",
 *                            "Unit item price", "Quantity sold", "Item rating",
 *                            "Orders with item", "Item quantity per order"
 *   Row 4+: Data rows
 *
 * The parser is tolerant of:
 *  - Comma-separated or tab-separated files
 *  - Quoted fields
 *  - BOM characters
 *  - Missing metadata header rows (date range can be supplied externally)
 */

export interface ParsedZomatoItem {
  itemName: string;
  category: string;
  subCategory: string;
  quantitySold: number;
  unitPrice: number;
  revenue: number; // quantitySold * unitPrice
}

export interface ZomatoCsvParseResult {
  items: ParsedZomatoItem[];
  /** ISO date string yyyy-MM-dd or null if not found in file */
  reportStartDate: string | null;
  /** ISO date string yyyy-MM-dd or null if not found in file */
  reportEndDate: string | null;
  /** Raw lines that were scanned for debugging */
  rawHeaderLines: string[];
  errors: string[];
}

// ── Month name → 0-based index ───────────────────────────────────────────────
const MONTH_MAP: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function parseMonthName(s: string): number | null {
  return MONTH_MAP[s.toLowerCase().slice(0, 3)] ?? null;
}

/**
 * Parse a date token like "08 Jun, 2025", "08 Jun 2025", "2025-06-08", "08/06/2025"
 * Returns an ISO date string (yyyy-MM-dd) or null.
 */
function parseFlexDate(raw: string): string | null {
  const s = raw.trim();

  // ISO format: 2025-06-08
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return s;

  // DD/MM/YYYY
  const dmyMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // "08 Jun, 2025" or "08 Jun 2025"
  const namedMatch = s.match(/^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/);
  if (namedMatch) {
    const [, d, mon, y] = namedMatch;
    const m = parseMonthName(mon);
    if (m !== null) {
      return `${y}-${String(m + 1).padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
  }

  // "Jun 08, 2025" or "Jun 08 2025"
  const namedMatch2 = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (namedMatch2) {
    const [, mon, d, y] = namedMatch2;
    const m = parseMonthName(mon);
    if (m !== null) {
      return `${y}-${String(m + 1).padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
  }

  return null;
}

/**
 * Scan up to the first 8 lines for a date range pattern.
 * Returns [startIso, endIso] or null.
 */
function extractDateRange(lines: string[]): [string, string] | null {
  // Separators between start and end date: " - ", " to ", " – ", " — "
  const sepPattern = /\s+[-–—]|\s+to\s+/i;

  for (const line of lines.slice(0, 8)) {
    const stripped = line.replace(/^["'\s]+|["'\s]+$/g, '');
    const parts = stripped.split(sepPattern);
    if (parts.length < 2) continue;

    const start = parseFlexDate(parts[0].trim().replace(/,\s*$/, ''));
    // The end part might have trailing garbage (e.g. extra CSV commas)
    const endRaw = parts[1].split(',')[0].trim();
    const end = parseFlexDate(endRaw);

    if (start && end) return [start, end];
  }
  return null;
}

// ── CSV tokeniser ─────────────────────────────────────────────────────────────

function detectDelimiter(firstLine: string): string {
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return tabs > commas ? '\t' : ',';
}

/** Minimal RFC 4180-compatible CSV row parser */
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

// ── Column name normaliser ────────────────────────────────────────────────────

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const HEADER_ALIASES: Record<string, string[]> = {
  itemName:     ['itemname', 'item', 'name', 'itemtitle'],
  category:     ['category', 'cat'],
  subCategory:  ['subcategory', 'subcat', 'subcategory'],
  unitPrice:    ['unitprice', 'unitcost', 'unititemcost', 'unititemsellprice', 'unititemsellingprice', 'price', 'unitsellingprice', 'sellingprice'],
  quantitySold: ['quantitysold', 'qtysold', 'quantity', 'qty', 'sold', 'quantityordered'],
};

function resolveHeaderIndex(headers: string[], field: string): number {
  const aliases = HEADER_ALIASES[field] ?? [];
  return headers.findIndex((h) => aliases.includes(normalise(h)));
}

// ── Main export ───────────────────────────────────────────────────────────────

export function parseZomatoCsv(csvText: string): ZomatoCsvParseResult {
  const errors: string[] = [];

  // Strip BOM
  const clean = csvText.replace(/^﻿/, '');
  const rawLines = clean.split(/\r?\n/);
  const rawHeaderLines = rawLines.slice(0, 8);

  const delimiter = detectDelimiter(rawLines[0] || '');

  // Try to extract date range
  const dateRange = extractDateRange(rawLines);

  // Find header row
  let headerRowIdx = -1;
  let headerFields: string[] = [];
  for (let i = 0; i < Math.min(rawLines.length, 10); i++) {
    const fields = parseCsvRow(rawLines[i], delimiter);
    const norm = fields.map(normalise);
    const hasItemName = norm.some((f) =>
      HEADER_ALIASES.itemName.some((a) => f.includes(a))
    );
    const hasQty = norm.some((f) =>
      HEADER_ALIASES.quantitySold.some((a) => f.includes(a))
    );
    if (hasItemName && hasQty) {
      headerRowIdx = i;
      headerFields = fields;
      break;
    }
  }

  if (headerRowIdx === -1) {
    errors.push('Could not find a header row with "Item name" and "Quantity sold" columns. Please verify this is a Zomato Item Sales Report.');
    return { items: [], reportStartDate: null, reportEndDate: null, rawHeaderLines, errors };
  }

  const idxItemName     = resolveHeaderIndex(headerFields, 'itemName');
  const idxCategory     = resolveHeaderIndex(headerFields, 'category');
  const idxSubCategory  = resolveHeaderIndex(headerFields, 'subCategory');
  const idxUnitPrice    = resolveHeaderIndex(headerFields, 'unitPrice');
  const idxQty          = resolveHeaderIndex(headerFields, 'quantitySold');

  if (idxItemName === -1) errors.push('Missing column: Item name');
  if (idxQty === -1)      errors.push('Missing column: Quantity sold');
  if (idxUnitPrice === -1) errors.push('Missing column: Unit item price');

  if (errors.length > 0) {
    return { items: [], reportStartDate: null, reportEndDate: null, rawHeaderLines, errors };
  }

  const items: ParsedZomatoItem[] = [];

  for (let i = headerRowIdx + 1; i < rawLines.length; i++) {
    const line = rawLines[i].trim();
    if (!line) continue;

    const fields = parseCsvRow(line, delimiter);
    const itemName = fields[idxItemName]?.trim() ?? '';
    if (!itemName) continue;

    const quantitySold = parseFloat(fields[idxQty] ?? '0') || 0;
    const unitPrice    = parseFloat(fields[idxUnitPrice] ?? '0') || 0;
    const category     = idxCategory !== -1 ? (fields[idxCategory]?.trim() ?? '') : '';
    const subCategory  = idxSubCategory !== -1 ? (fields[idxSubCategory]?.trim() ?? '') : '';

    // Skip summary / total rows
    if (
      normalise(itemName) === 'total' ||
      normalise(itemName).startsWith('grandtotal') ||
      normalise(itemName).startsWith('subtotal')
    ) continue;

    items.push({
      itemName,
      category,
      subCategory,
      quantitySold,
      unitPrice,
      revenue: Math.round(quantitySold * unitPrice * 100) / 100,
    });
  }

  if (items.length === 0) {
    errors.push('No valid item rows found after the header. Please check the CSV file.');
  }

  return {
    items,
    reportStartDate: dateRange?.[0] ?? null,
    reportEndDate:   dateRange?.[1] ?? null,
    rawHeaderLines,
    errors,
  };
}
