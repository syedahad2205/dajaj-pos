import type { CellValue, Workbook, Worksheet } from "exceljs";

// ─────────────────────────────────────────────────────────────────────────
// Finance backup / restore — workbook format.
//
// Every finance collection is exported to its own sheet, one row per
// Firestore document, `_id` in column A. The `_columns` sheet records each
// column's type so the import can rebuild the exact same documents (numbers
// stay numbers, timestamps keep nanosecond precision, nested maps/arrays
// survive as JSON). Daily Closing expense/deposit line items get their own
// child sheets so they can be read and corrected like normal rows.
//
// Cell conventions (all sheets):
//   (empty)      ""  for a text column; field not present for any other type
//   #NONE        field not present on the document
//   #NULL        null
//   #ROWS        array whose items live in the child sheet (<sheet>.<field>)
//   #OVERFLOW:k  value too long for one Excel cell; stored in `_overflow`
//   \#...        a text value that really starts with "#" (escaped)
//
// Data travels between the API and the browser as "wire" JSON, where
// Firestore-only types are tagged: {"__ts": iso}, {"__ref": path},
// {"__geo": [lat, lng]}, {"__bytes": base64}.
// ─────────────────────────────────────────────────────────────────────────

export const BACKUP_FORMAT = "dajaj-finance-backup";
export const BACKUP_VERSION = 1;

export interface BackupCollectionConfig {
  name: string;
  label: string;
  /** Array-of-objects fields exported to their own child sheet. */
  childArrays?: string[];
  /** Columns shown first, in this order; the rest follow alphabetically. */
  preferredColumns?: string[];
}

/**
 * Everything that makes up the finance system. Deliberately excluded:
 * finance_auth (legacy mobile logins — password hashes must never land in a
 * spreadsheet) and fin_mobile_idempotency (a short-lived replay cache).
 */
export const BACKUP_COLLECTIONS: BackupCollectionConfig[] = [
  {
    name: "fin_accounts",
    label: "Accounts (opening & current balances)",
    preferredColumns: ["name", "type", "status", "openingBalance", "currentBalance", "displayOrder", "branchId"],
  },
  {
    name: "fin_transactions",
    label: "Ledger transactions",
    preferredColumns: [
      "date", "time", "type", "status", "amount", "categoryName", "subcategoryName", "fromAccountName", "toAccountName",
      "vendorName", "description", "remarks", "referenceNumber", "paymentMethod", "autoPosted", "autoPostedSource",
    ],
  },
  {
    name: "fin_daily_closing",
    label: "Daily Closings",
    childArrays: ["expenses", "deposits"],
    preferredColumns: [
      "date", "locked", "openingCash", "openingCashSource", "externalCashAdjustment", "closingCash", "cashRevenue",
      "upiSales", "zomatoSales", "swiggySales", "otherIncome", "totalRevenue", "cashExpenseTotal", "depositTotal",
      "totalCashOut", "expenses", "deposits",
    ],
  },
  { name: "fin_expense_categories", label: "Expense categories", preferredColumns: ["name", "active", "displayOrder"] },
  { name: "fin_expense_subcategories", label: "Expense subcategories", preferredColumns: ["name", "categoryId", "categoryName", "active"] },
  { name: "fin_income_categories", label: "Income categories", preferredColumns: ["name", "active", "displayOrder"] },
  { name: "fin_vendors", label: "Vendors", preferredColumns: ["name", "phone", "status"] },
  { name: "finance_defaults", label: "Finance Defaults (event → account)", preferredColumns: ["eventName", "destinationAccountId", "isActive"] },
  { name: "fin_settings", label: "Finance settings" },
  { name: "finance_managers", label: "Finance Managers", preferredColumns: ["name", "email", "active"] },
  { name: "quick_entry_payee_rules", label: "Quick Entry payee rules" },
  { name: "quick_entry_records", label: "Quick Entry records" },
  { name: "quick_entry_activity_logs", label: "Quick Entry activity log" },
  { name: "finance_ai_chat_messages", label: "AI Assistant chat" },
  { name: "finance_ai_chat_settings", label: "AI Assistant settings" },
  { name: "zomato_imports", label: "Zomato payout imports / settlements", preferredColumns: ["reportStartDate", "reportEndDate", "status"] },
  { name: "swiggy_imports", label: "Swiggy payout imports / settlements", preferredColumns: ["reportStartDate", "reportEndDate", "status"] },
  { name: "fin_audit_logs", label: "Finance audit log", preferredColumns: ["timestamp", "module", "action", "entityLabel", "userName"] },
];

export const BACKUP_COLLECTION_NAMES = new Set(BACKUP_COLLECTIONS.map((c) => c.name));

// ── Wire values ─────────────────────────────────────────────────────────────

export type WireValue = null | string | number | boolean | WireValue[] | { [key: string]: WireValue };
export type WireData = { [field: string]: WireValue };
export interface WireDoc {
  id: string;
  data: WireData;
}

export function isPlainWireObject(value: WireValue | undefined): value is { [key: string]: WireValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const TAG_KEYS = ["__ts", "__ref", "__geo", "__bytes"];

export function wireTag(value: WireValue | undefined): string | null {
  if (!isPlainWireObject(value)) return null;
  const keys = Object.keys(value);
  return keys.length === 1 && TAG_KEYS.includes(keys[0]) ? keys[0] : null;
}

/** Exact, nanosecond-preserving UTC ISO string for a Firestore Timestamp. */
export function timestampToIso(seconds: number, nanoseconds: number): string {
  const base = new Date(seconds * 1000).toISOString().slice(0, 19);
  const nanos = String(nanoseconds).padStart(9, "0");
  return `${base}.${nanoseconds % 1_000_000 === 0 ? nanos.slice(0, 3) : nanos}Z`;
}

const ISO_TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/;

export function isoToTimestampParts(iso: string): { seconds: number; nanoseconds: number } | null {
  const match = ISO_TIMESTAMP_PATTERN.exec(iso.trim());
  if (!match) return null;
  const ms = Date.parse(`${match[1]}T${match[2]}Z`);
  if (Number.isNaN(ms)) return null;
  return { seconds: Math.floor(ms / 1000), nanoseconds: Number((match[3] ?? "").padEnd(9, "0")) };
}

/** JSON.stringify with sorted object keys — used to compare documents. */
export function stableStringify(value: WireValue | undefined): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isPlainWireObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

// ── Column types & cell codec ───────────────────────────────────────────────

export type ColumnType = "string" | "number" | "boolean" | "timestamp" | "json" | "child";

const CELL_NONE = "#NONE";
const CELL_NULL = "#NULL";
const CELL_ROWS = "#ROWS";
const CELL_OVERFLOW_PREFIX = "#OVERFLOW:";
/** Excel's hard limit is 32,767 characters per cell. */
const MAX_CELL_TEXT = 32000;
const OVERFLOW_CHUNK = 30000;

function valueKind(value: WireValue): "null" | "string" | "number" | "boolean" | "timestamp" | "json" {
  if (value === null) return "null";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return Number.isFinite(value) ? "number" : "json";
  if (typeof value === "boolean") return "boolean";
  if (wireTag(value) === "__ts") return "timestamp";
  return "json";
}

function inferColumnType(values: WireValue[]): ColumnType {
  const kinds = new Set(values.map(valueKind));
  kinds.delete("null");
  if (kinds.size !== 1) return "json";
  const [only] = Array.from(kinds) as Exclude<ReturnType<typeof valueKind>, "null">[];
  return only;
}

function escapeText(text: string): string {
  return text.startsWith("#") || text.startsWith("\\") ? `\\${text}` : text;
}

function unescapeText(text: string): string {
  return text.startsWith("\\") ? text.slice(1) : text;
}

function isChildArrayValue(value: WireValue | undefined): boolean {
  return Array.isArray(value) && value.every((item) => isPlainWireObject(item) && wireTag(item) === null);
}

// ── Export: wire docs → workbook ────────────────────────────────────────────

export interface BackupMeta {
  exportedAt: string;
  exportedBy: string;
  counts: Record<string, number>;
}

interface ExportContext {
  columnRows: [string, string, ColumnType][];
  overflowRows: [string, number, string][];
  overflowSeq: number;
}

function writeTextCell(ctx: ExportContext, text: string): string {
  if (text.length <= MAX_CELL_TEXT) return text;
  ctx.overflowSeq += 1;
  const key = `OV${ctx.overflowSeq}`;
  for (let i = 0, part = 0; i < text.length; i += OVERFLOW_CHUNK, part += 1) {
    ctx.overflowRows.push([key, part, text.slice(i, i + OVERFLOW_CHUNK)]);
  }
  return `${CELL_OVERFLOW_PREFIX}${key}`;
}

function encodeCell(ctx: ExportContext, value: WireValue | undefined, type: ColumnType): CellValue {
  if (value === undefined) return CELL_NONE;
  if (type === "child") return CELL_ROWS;
  if (value === null) return CELL_NULL;
  switch (type) {
    case "string":
      return value === "" ? null : writeTextCell(ctx, escapeText(value as string));
    case "number":
    case "boolean":
      return value as number | boolean;
    case "timestamp":
      return (value as { __ts: string }).__ts;
    default:
      return writeTextCell(ctx, JSON.stringify(value));
  }
}

function orderColumns(fields: string[], preferred: string[] = []): string[] {
  const set = new Set(fields);
  const first = preferred.filter((f) => set.has(f));
  const rest = fields.filter((f) => !first.includes(f)).sort((a, b) => a.localeCompare(b));
  return [...first, ...rest];
}

function styleSheet(sheet: Worksheet, columnCount: number) {
  sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEA580C" } };
  if (columnCount > 0) sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnCount } };
}

function addDocSheet(
  workbook: Workbook,
  ctx: ExportContext,
  sheetName: string,
  rows: { lead: CellValue[]; data: WireData }[],
  leadColumns: string[],
  preferred: string[] | undefined,
  childFields: Set<string>,
) {
  const fieldValues = new Map<string, WireValue[]>();
  for (const row of rows) {
    for (const [field, value] of Object.entries(row.data)) {
      if (!fieldValues.has(field)) fieldValues.set(field, []);
      fieldValues.get(field)!.push(value);
    }
  }
  const fields = orderColumns(Array.from(fieldValues.keys()), preferred);
  const types = new Map<string, ColumnType>(
    fields.map((f) => [f, childFields.has(f) ? "child" : inferColumnType(fieldValues.get(f)!)]),
  );

  const sheet = workbook.addWorksheet(sheetName);
  const header = [...leadColumns, ...fields];
  sheet.addRow(header);
  for (const field of fields) ctx.columnRows.push([sheetName, field, types.get(field)!]);

  for (const row of rows) {
    sheet.addRow([...row.lead, ...fields.map((f) => encodeCell(ctx, row.data[f], types.get(f)!))]);
  }

  header.forEach((name, i) => {
    const column = sheet.getColumn(i + 1);
    column.width = Math.min(Math.max(name.length + 4, 12), 40);
    // Text columns stay text when edited in Excel (no auto-conversion of
    // reference numbers or date-like strings).
    if (i >= leadColumns.length && types.get(name) !== "number" && types.get(name) !== "boolean") column.numFmt = "@";
  });
  if (leadColumns[0] === "_id") sheet.getColumn(1).numFmt = "@";
  styleSheet(sheet, header.length);
}

function sortDocs(name: string, docs: WireDoc[]): WireDoc[] {
  const key = (d: WireDoc) =>
    name === "fin_transactions" ? `${String(d.data.date ?? "")} ${String(d.data.time ?? "")} ${d.id}` : d.id;
  return [...docs].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

export function buildBackupWorkbook(workbook: Workbook, collections: Record<string, WireDoc[]>, meta: BackupMeta): void {
  const ctx: ExportContext = { columnRows: [], overflowRows: [], overflowSeq: 0 };

  const readme = workbook.addWorksheet("README");
  readme.getColumn(1).width = 120;
  [
    "DAJAJ Finance backup",
    "",
    `Exported ${meta.exportedAt} (UTC) by ${meta.exportedBy}.`,
    "",
    "Restore it from Finance → Settings → Backup & Restore. The import shows exactly what will change before anything is written.",
    "",
    "One sheet per finance collection, one row per record. Column A (_id) is the record's id — do not change it.",
    "fin_daily_closing.expenses / fin_daily_closing.deposits hold each day's line items (_parentId = the date, _index = order).",
    "",
    "Cell codes: empty = blank text (or no value for non-text columns) · #NONE = field not set · #NULL = null ·",
    "#ROWS = items are in the child sheet · #OVERFLOW:… = long value stored in _overflow · \\# = text starting with #.",
    "Timestamps are UTC (…Z). JSON columns hold nested data exactly as stored.",
    "",
    "You can correct values, add rows or delete rows. Do not rename sheets or headers, and do not edit _columns / _meta / _overflow.",
  ].forEach((line) => readme.addRow([line]));
  readme.getRow(1).font = { bold: true, size: 16 };

  for (const config of BACKUP_COLLECTIONS) {
    const docs = sortDocs(config.name, collections[config.name] ?? []);
    const childFields = new Set(
      (config.childArrays ?? []).filter((field) =>
        docs.every((d) => d.data[field] === undefined || isChildArrayValue(d.data[field])),
      ),
    );

    addDocSheet(
      workbook,
      ctx,
      config.name,
      docs.map((d) => ({ lead: [d.id], data: d.data })),
      ["_id"],
      config.preferredColumns,
      childFields,
    );

    for (const field of Array.from(childFields)) {
      const childRows: { lead: CellValue[]; data: WireData }[] = [];
      for (const d of docs) {
        const items = d.data[field];
        if (!Array.isArray(items)) continue;
        items.forEach((item, index) => childRows.push({ lead: [d.id, index], data: item as WireData }));
      }
      addDocSheet(workbook, ctx, `${config.name}.${field}`, childRows, ["_parentId", "_index"], ["id", "categoryName", "subcategoryName", "type", "amount", "remarks"], new Set());
    }
  }

  const columns = workbook.addWorksheet("_columns");
  columns.addRow(["sheet", "column", "type"]);
  ctx.columnRows.forEach((row) => columns.addRow(row));
  styleSheet(columns, 3);

  const overflow = workbook.addWorksheet("_overflow");
  overflow.addRow(["key", "part", "text"]);
  ctx.overflowRows.forEach((row) => overflow.addRow(row));
  overflow.getColumn(3).numFmt = "@";
  styleSheet(overflow, 3);

  const metaSheet = workbook.addWorksheet("_meta");
  metaSheet.addRow(["key", "value"]);
  metaSheet.addRow(["format", BACKUP_FORMAT]);
  metaSheet.addRow(["version", BACKUP_VERSION]);
  metaSheet.addRow(["exportedAt", meta.exportedAt]);
  metaSheet.addRow(["exportedBy", meta.exportedBy]);
  metaSheet.addRow(["counts", JSON.stringify(meta.counts)]);
  styleSheet(metaSheet, 2);
}

// ── Import: workbook → wire docs ────────────────────────────────────────────

export interface ParsedBackup {
  meta: Partial<BackupMeta> & { format?: string; version?: number };
  collections: Record<string, WireDoc[]>;
  errors: string[];
}

type RawCell = string | number | boolean | Date | null;

function readCell(value: CellValue): RawCell {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((r) => r.text).join("");
    if ("formula" in value || "sharedFormula" in value) return readCell((value as { result?: CellValue }).result ?? null);
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("error" in value) return null;
  }
  return String(value);
}

function dateToText(date: Date): string {
  const iso = date.toISOString();
  return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
}

class CellError extends Error {}

function decodeCell(raw: RawCell, type: ColumnType, overflow: Map<string, string>): WireValue | undefined {
  if (typeof raw === "string") {
    if (raw === CELL_NONE) return undefined;
    if (raw === CELL_NULL) return null;
    if (raw.startsWith(CELL_OVERFLOW_PREFIX)) {
      const full = overflow.get(raw.slice(CELL_OVERFLOW_PREFIX.length));
      if (full === undefined) throw new CellError(`missing ${raw} in _overflow`);
      raw = full;
    }
  }

  switch (type) {
    case "child":
      // Placeholder — parseBackupWorkbook fills it from the child sheet.
      if (raw === CELL_ROWS) return [];
      throw new CellError(`must be ${CELL_ROWS} (items in the child sheet) or ${CELL_NONE}`);
    case "string":
      if (raw === null) return "";
      if (raw instanceof Date) return dateToText(raw);
      return typeof raw === "string" ? unescapeText(raw) : String(raw);
    case "number": {
      if (raw === null || raw === "") return undefined;
      const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, "").trim());
      if (!Number.isFinite(n)) throw new CellError(`"${String(raw)}" is not a number`);
      return n;
    }
    case "boolean":
      if (raw === null || raw === "") return undefined;
      if (typeof raw === "boolean") return raw;
      if (/^(true|yes|1)$/i.test(String(raw).trim())) return true;
      if (/^(false|no|0)$/i.test(String(raw).trim())) return false;
      throw new CellError(`"${String(raw)}" is not TRUE/FALSE`);
    case "timestamp": {
      if (raw === null || raw === "") return undefined;
      if (raw instanceof Date) return { __ts: raw.toISOString() };
      const text = String(raw).trim();
      if (!isoToTimestampParts(text)) throw new CellError(`"${text}" is not a UTC timestamp like 2026-10-12T09:30:00.000Z`);
      return { __ts: text };
    }
    case "json":
      if (raw === null || raw === "") return undefined;
      if (typeof raw !== "string") return typeof raw === "number" || typeof raw === "boolean" ? raw : dateToText(raw);
      try {
        return JSON.parse(raw) as WireValue;
      } catch {
        throw new CellError("is not valid JSON");
      }
    default:
      throw new CellError(`unknown column type "${type}"`);
  }
}

function sheetRows(sheet: Worksheet): { rowNumber: number; cells: RawCell[] }[] {
  const rows: { rowNumber: number; cells: RawCell[] }[] = [];
  const width = sheet.getRow(1).cellCount;
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const cells: RawCell[] = [];
    for (let c = 1; c <= Math.max(width, row.cellCount); c += 1) cells.push(readCell(row.getCell(c).value));
    if (cells.some((cell) => cell !== null && cell !== "")) rows.push({ rowNumber, cells });
  });
  return rows;
}

function headerOf(sheet: Worksheet): string[] {
  const header: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    header[col - 1] = String(readCell(cell.value) ?? "").trim();
  });
  return header;
}

function validDocId(id: string): boolean {
  return id.length > 0 && id.length <= 1500 && !id.includes("/") && id !== "." && id !== ".." && !/^__.*__$/.test(id);
}

export function parseBackupWorkbook(workbook: Workbook): ParsedBackup {
  const errors: string[] = [];
  const result: ParsedBackup = { meta: {}, collections: {}, errors };

  const metaSheet = workbook.getWorksheet("_meta");
  const columnsSheet = workbook.getWorksheet("_columns");
  if (!metaSheet || !columnsSheet) {
    errors.push("This file is not a DAJAJ finance backup (the _meta / _columns sheets are missing).");
    return result;
  }
  for (const { cells } of sheetRows(metaSheet)) {
    const [key, value] = cells;
    if (key === "format") result.meta.format = String(value);
    if (key === "version") result.meta.version = Number(value);
    if (key === "exportedAt") result.meta.exportedAt = String(value);
    if (key === "exportedBy") result.meta.exportedBy = String(value);
  }
  if (result.meta.format !== BACKUP_FORMAT) errors.push("This file is not a DAJAJ finance backup.");
  if (result.meta.version !== BACKUP_VERSION) errors.push(`Unsupported backup version ${result.meta.version ?? "?"} (expected ${BACKUP_VERSION}).`);
  if (errors.length > 0) return result;

  const columnTypes = new Map<string, Map<string, ColumnType>>();
  for (const { cells } of sheetRows(columnsSheet)) {
    const [sheetName, column, type] = cells.map((c) => String(c ?? ""));
    if (!columnTypes.has(sheetName)) columnTypes.set(sheetName, new Map());
    columnTypes.get(sheetName)!.set(column, type as ColumnType);
  }

  const overflow = new Map<string, string>();
  const overflowSheet = workbook.getWorksheet("_overflow");
  if (overflowSheet) {
    const parts = new Map<string, string[]>();
    for (const { cells } of sheetRows(overflowSheet)) {
      const key = String(cells[0] ?? "");
      if (!parts.has(key)) parts.set(key, []);
      parts.get(key)![Number(cells[1])] = String(cells[2] ?? "");
    }
    parts.forEach((chunks, key) => overflow.set(key, chunks.join("")));
  }

  const readSheet = (sheetName: string, leadColumns: string[]) => {
    const sheet = workbook.getWorksheet(sheetName);
    if (!sheet) return null;
    const types = columnTypes.get(sheetName) ?? new Map<string, ColumnType>();
    const header = headerOf(sheet);
    for (let i = 0; i < leadColumns.length; i += 1) {
      if (header[i] !== leadColumns[i]) {
        errors.push(`${sheetName}: column ${i + 1} must be "${leadColumns[i]}".`);
        return null;
      }
    }
    const fields = header.slice(leadColumns.length);
    fields.forEach((field) => {
      if (field && !types.has(field)) errors.push(`${sheetName}: column "${field}" is not in _columns, so its type is unknown. Remove it or add it to _columns.`);
    });

    const rows: { rowNumber: number; lead: RawCell[]; data: WireData }[] = [];
    for (const { rowNumber, cells } of sheetRows(sheet)) {
      const data: WireData = {};
      fields.forEach((field, i) => {
        const type = types.get(field);
        if (!field || !type) return;
        try {
          const value = decodeCell(cells[leadColumns.length + i] ?? null, type, overflow);
          if (value !== undefined) data[field] = value;
        } catch (err) {
          errors.push(`${sheetName} row ${rowNumber}, column "${field}": ${err instanceof Error ? err.message : "invalid value"}.`);
        }
      });
      rows.push({ rowNumber, lead: cells.slice(0, leadColumns.length), data });
    }
    return { rows, types };
  };

  for (const config of BACKUP_COLLECTIONS) {
    const parsed = readSheet(config.name, ["_id"]);
    if (!parsed) continue;

    const docs: WireDoc[] = [];
    const seen = new Set<string>();
    for (const row of parsed.rows) {
      const id = row.lead[0] instanceof Date ? dateToText(row.lead[0]) : unescapeText(String(row.lead[0] ?? "").trim());
      if (!validDocId(id)) {
        errors.push(`${config.name} row ${row.rowNumber}: invalid or missing _id "${id}".`);
        continue;
      }
      if (seen.has(id)) {
        errors.push(`${config.name} row ${row.rowNumber}: duplicate _id "${id}".`);
        continue;
      }
      seen.add(id);
      docs.push({ id, data: row.data });
    }

    const byId = new Map(docs.map((d) => [d.id, d]));
    parsed.types.forEach((type, field) => {
      if (type !== "child") return;
      const childSheetName = `${config.name}.${field}`;
      const child = readSheet(childSheetName, ["_parentId", "_index"]);
      if (!child) {
        errors.push(`${config.name}: column "${field}" says #ROWS but sheet "${childSheetName}" is missing.`);
        return;
      }
      const items = new Map<string, { index: number; data: WireData }[]>();
      for (const row of child.rows) {
        const parentId = row.lead[0] instanceof Date ? dateToText(row.lead[0]) : String(row.lead[0] ?? "").trim();
        const index = Number(row.lead[1]);
        const parent = byId.get(parentId);
        if (!parent || !(field in parent.data)) {
          errors.push(`${childSheetName} row ${row.rowNumber}: _parentId "${parentId}" has no matching ${config.name} row with ${field} = #ROWS.`);
          continue;
        }
        if (!Number.isFinite(index)) {
          errors.push(`${childSheetName} row ${row.rowNumber}: _index must be a number.`);
          continue;
        }
        if (!items.has(parentId)) items.set(parentId, []);
        items.get(parentId)!.push({ index, data: row.data });
      }
      for (const d of docs) {
        if (!(field in d.data)) continue;
        d.data[field] = (items.get(d.id) ?? []).sort((a, b) => a.index - b.index).map((item) => item.data);
      }
    });

    result.collections[config.name] = docs;
  }

  return result;
}

// ── Diff & consistency checks ───────────────────────────────────────────────

export interface CollectionDiff {
  collection: string;
  inSheet: number;
  inDatabase: number;
  added: string[];
  changed: { id: string; fields: string[] }[];
  unchanged: number;
  removed: string[];
}

export function diffCollection(collection: string, sheetDocs: WireDoc[], currentDocs: WireDoc[]): CollectionDiff {
  const current = new Map(currentDocs.map((d) => [d.id, d.data]));
  const diff: CollectionDiff = {
    collection,
    inSheet: sheetDocs.length,
    inDatabase: currentDocs.length,
    added: [],
    changed: [],
    unchanged: 0,
    removed: [],
  };
  const sheetIds = new Set<string>();
  for (const doc of sheetDocs) {
    sheetIds.add(doc.id);
    const existing = current.get(doc.id);
    if (!existing) {
      diff.added.push(doc.id);
      continue;
    }
    const fields = Array.from(new Set([...Object.keys(existing), ...Object.keys(doc.data)])).filter(
      (f) => stableStringify(existing[f]) !== stableStringify(doc.data[f]),
    );
    if (fields.length > 0) diff.changed.push({ id: doc.id, fields: fields.sort() });
    else diff.unchanged += 1;
  }
  diff.removed = currentDocs.filter((d) => !sheetIds.has(d.id)).map((d) => d.id);
  return diff;
}

function num(value: WireValue | undefined): number {
  return typeof value === "number" ? value : 0;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Sanity checks on a backup's own data, so a restore never silently brings
 * back a broken state: stored account balances vs what the ledger implies,
 * Daily Closing totals vs their line items, and auto-post references that
 * point at missing transactions.
 */
export function checkBackupConsistency(collections: Record<string, WireDoc[]>): string[] {
  const warnings: string[] = [];
  const transactions = collections.fin_transactions ?? [];
  const posted = transactions.filter((t) => t.data.status !== "void");

  for (const account of collections.fin_accounts ?? []) {
    let ledger = num(account.data.openingBalance);
    for (const t of posted) {
      if (t.data.toAccountId === account.id) ledger += num(t.data.amount);
      if (t.data.fromAccountId === account.id) ledger -= num(t.data.amount);
    }
    const stored = num(account.data.currentBalance);
    if (Math.abs(round2(ledger) - stored) >= 0.01) {
      warnings.push(
        `Account "${String(account.data.name ?? account.id)}": stored balance ${stored.toFixed(2)} but opening balance + ledger = ${round2(ledger).toFixed(2)}.`,
      );
    }
  }

  const transactionIds = new Set(transactions.map((t) => t.id));
  for (const closing of collections.fin_daily_closing ?? []) {
    const expenses = Array.isArray(closing.data.expenses) ? closing.data.expenses : [];
    const deposits = Array.isArray(closing.data.deposits) ? closing.data.deposits : [];
    const expenseSum = round2(expenses.reduce<number>((s, e) => s + (isPlainWireObject(e) ? num(e.amount) : 0), 0));
    const depositSum = round2(deposits.reduce<number>((s, d) => s + (isPlainWireObject(d) ? num(d.amount) : 0), 0));
    if ("cashExpenseTotal" in closing.data && Math.abs(expenseSum - num(closing.data.cashExpenseTotal)) >= 0.01) {
      warnings.push(`Daily Closing ${closing.id}: cashExpenseTotal ${num(closing.data.cashExpenseTotal)} ≠ sum of expense rows ${expenseSum}.`);
    }
    if ("depositTotal" in closing.data && Math.abs(depositSum - num(closing.data.depositTotal)) >= 0.01) {
      warnings.push(`Daily Closing ${closing.id}: depositTotal ${num(closing.data.depositTotal)} ≠ sum of deposit rows ${depositSum}.`);
    }
    const autoPosted = closing.data.autoPostedTransactionsByEvent;
    if (isPlainWireObject(autoPosted) && transactions.length > 0) {
      for (const [eventKey, txId] of Object.entries(autoPosted)) {
        if (typeof txId === "string" && !transactionIds.has(txId)) {
          warnings.push(`Daily Closing ${closing.id}: ${eventKey} points at transaction ${txId}, which is not in fin_transactions.`);
        }
      }
    }
  }

  return warnings;
}
