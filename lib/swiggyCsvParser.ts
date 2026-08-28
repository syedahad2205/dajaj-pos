/**
 * Swiggy "Past Orders" Report CSV Parser
 *
 * Unlike Zomato's Item Sales Report, Swiggy's partner portal does not export
 * a per-item/category sales report at all. The only report with item-level
 * detail is the order-level "Past Orders" export, and it does not have a
 * fixed column count — Swiggy appends one extra trailing column per item in
 * the order (unquoted, so a 4-item order literally has 4 more CSV columns
 * than a 1-item order). There is no category column here at all; category
 * has to be resolved afterwards against a maintained item→category map (see
 * services/swiggyCategoryMapService.ts).
 *
 * Header row (columns 0–29 fixed, then one column per item from 30 onward):
 *   Order ID | Order-status | Order-relay-time(ordered time) |
 *   Order-acceptance-time <placed_time> | Order-delivery-time |
 *   Total-bill-amount <bill> | Tax Restaurant | Item-SGST | Item-CGST |
 *   Item-IGST | PackagingCharge-SGST | PackagingCharge-CGST |
 *   PackagingCharge-IGST | ServiceCharge-SGST | ServiceCharge-CGST |
 *   ServiceCharge-IGST | Item-GST-Inclusive | Packaging_GST_Inclusive |
 *   ServiceCharge-GST-inclusive | Restaurant Trade Discount |
 *   Restaurant Coupon Discount Share | Packing-charge | Cancelled reason |
 *   Food-prepared <Yes/No> | Order-Cancellation-time | Edited-status |
 *   Item-count | MOU type | Cancellation-responsible-entity |
 *   Restaurant-bear | Item1-name_reward_type_quantity_price+Variants+Addons
 *   [ ...one more such column per additional item in the order ]
 *
 * Each item column looks like:
 *   "Kuboos Shawarma_NA_5_570+Peri Peri"        → name, rewardType, qty, price+variant
 *   "Garlic Mayo_NA_2_60"                       → no variant suffix
 *
 * Confirmed against real data: the trailing number is the TOTAL price for
 * that line (already qty-multiplied, not a per-unit price) — e.g. "Kuboos
 * Shawarma_NA_3_267" appears elsewhere as a single unit at ₹89, and 89×3=267.
 * It is also confirmed exclusive of GST (`Item-GST-Inclusive` is `false` on
 * every sampled row, and `Tax Restaurant` / bill amount reconcile at 5% on
 * top of the item price) — the same "pre-GST item revenue" basis Zomato's
 * parser already uses, so category/settlement math can treat both platforms
 * identically.
 *
 * Only orders with status "delivered" are counted — cancelled/other rows
 * carry no real revenue.
 */

export interface ParsedSwiggyItem {
  orderId: string;
  /** ISO date yyyy-MM-dd — from delivery time, falling back to relay time */
  date: string;
  itemName: string;
  quantity: number;
  /** Pre-GST unit price (price / quantity) */
  unitPrice: number;
  /** Pre-GST revenue for this line (already qty-multiplied, as given by Swiggy) */
  revenue: number;
  variant: string;
}

export interface SwiggyCsvParseResult {
  items: ParsedSwiggyItem[];
  /** ISO date string yyyy-MM-dd from the "Duration :" row, if present */
  reportStartDate: string | null;
  reportEndDate: string | null;
  ordersParsed: number;
  ordersSkipped: number;
  errors: string[];
}

// ── CSV tokeniser (quote-aware) ────────────────────────────────────────────────

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

// ── Column indices (fixed prefix; items start at COL_ITEMS_START) ─────────────

const COL_ORDER_ID       = 0;
const COL_ORDER_STATUS   = 1;
const COL_RELAY_TIME     = 2;
const COL_DELIVERY_TIME  = 4;
const COL_ITEMS_START    = 30;

/** yyyy-MM-dd from a "yyyy-MM-dd HH:mm:ss" timestamp (or already-ISO date). */
function dateFromTimestamp(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/**
 * Parse one item chunk, e.g. "Kuboos Shawarma_NA_5_570+Peri Peri" or
 * "Garlic Mayo_NA_2_60". Format: <name>_<rewardType>_<qty>_<price>[+<variant>[+<addon>...]]
 * Splits from the right so item names containing underscores (rare) still work.
 */
function parseItemChunk(chunk: string): { itemName: string; quantity: number; revenue: number; variant: string } | null {
  const trimmed = chunk.trim();
  if (!trimmed) return null;

  const parts = trimmed.split('_');
  if (parts.length < 4) return null; // malformed — need at least name_reward_qty_price

  const priceAndVariant = parts[parts.length - 1];
  const qtyRaw          = parts[parts.length - 2];
  // parts[parts.length - 3] is reward type ("NA" etc.) — not needed
  const itemName        = parts.slice(0, parts.length - 3).join('_').trim();

  if (!itemName) return null;

  const [priceRaw, ...variantParts] = priceAndVariant.split('+');
  const quantity = parseFloat(qtyRaw);
  const revenue  = parseFloat(priceRaw);

  if (!isFinite(quantity) || quantity <= 0 || !isFinite(revenue) || revenue < 0) return null;

  return {
    itemName,
    quantity,
    revenue: Math.round(revenue * 100) / 100,
    variant: variantParts.join('+'),
  };
}

export function parseSwiggyCsv(csvText: string): SwiggyCsvParseResult {
  const errors: string[] = [];
  const clean = csvText.replace(/^﻿/, '');
  const rawLines = clean.split(/\r?\n/).filter((l) => l.trim() !== '');

  if (rawLines.length < 2) {
    return { items: [], reportStartDate: null, reportEndDate: null, ordersParsed: 0, ordersSkipped: 0, errors: ['CSV appears to be empty.'] };
  }

  const delimiter = detectDelimiter(rawLines[0]);

  // Duration row: "Duration :,2026-08-16,2026-08-22" — search the first few
  // lines rather than hardcoding a row index, in case Swiggy reorders things.
  let reportStartDate: string | null = null;
  let reportEndDate: string | null = null;
  let headerRowIndex = -1;

  for (let i = 0; i < Math.min(rawLines.length, 15); i++) {
    const fields = parseCsvRow(rawLines[i], delimiter);
    if (fields[0]?.toLowerCase().startsWith('duration')) {
      reportStartDate = dateFromTimestamp(fields[1]);
      reportEndDate   = dateFromTimestamp(fields[2]);
    }
    if (fields[COL_ORDER_ID]?.trim().toLowerCase() === 'order id') {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) {
    errors.push('Could not find the header row (expected a column labelled "Order ID"). Is this a Swiggy Past Orders report?');
    return { items: [], reportStartDate, reportEndDate, ordersParsed: 0, ordersSkipped: 0, errors };
  }

  const items: ParsedSwiggyItem[] = [];
  let ordersParsed = 0;
  let ordersSkipped = 0;

  for (let i = headerRowIndex + 1; i < rawLines.length; i++) {
    const fields = parseCsvRow(rawLines[i], delimiter);
    if (fields.length <= COL_ITEMS_START) { ordersSkipped++; continue; }

    const orderId = fields[COL_ORDER_ID]?.trim() ?? '';
    const status  = fields[COL_ORDER_STATUS]?.trim().toLowerCase() ?? '';
    if (!orderId || status !== 'delivered') { ordersSkipped++; continue; }

    const date = dateFromTimestamp(fields[COL_DELIVERY_TIME]) ?? dateFromTimestamp(fields[COL_RELAY_TIME]);
    if (!date) { ordersSkipped++; continue; }

    let matchedAnyItem = false;
    for (let c = COL_ITEMS_START; c < fields.length; c++) {
      const parsed = parseItemChunk(fields[c]);
      if (!parsed) continue;
      matchedAnyItem = true;
      items.push({
        orderId,
        date,
        itemName: parsed.itemName,
        quantity: parsed.quantity,
        unitPrice: Math.round((parsed.revenue / parsed.quantity) * 100) / 100,
        revenue: parsed.revenue,
        variant: parsed.variant,
      });
    }

    if (matchedAnyItem) ordersParsed++;
    else ordersSkipped++;
  }

  if (items.length === 0) {
    errors.push('No delivered orders with parseable items were found in this file.');
  }

  return { items, reportStartDate, reportEndDate, ordersParsed, ordersSkipped, errors };
}
