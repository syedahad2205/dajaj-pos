/**
 * P0 verification of the locked opening-cash rule (no Firestore).
 *   today opening = yesterday locked closing + net Cash Drawer Transfers today
 */
import {
  canEditDailyClosingDate,
  dailyClosingWorkDate,
  netCashDrawerTransferAdjustment,
  openingCashFromPrevClosingAndTransfers,
  roundCurrency,
} from "../lib/finance";

const DRAWER = "cash-drawer";
const BANK = "bank";

function tx(
  type: string,
  amount: number,
  fromAccountId: string | null,
  toAccountId: string | null,
  extra: { autoPostedSource?: string | null; status?: string } = {},
) {
  return { type, amount, fromAccountId, toAccountId, status: extra.status ?? "posted", autoPostedSource: extra.autoPostedSource ?? null };
}

function opening(prevClosing: number, txs: ReturnType<typeof tx>[]) {
  return openingCashFromPrevClosingAndTransfers(prevClosing, netCashDrawerTransferAdjustment(txs, DRAWER));
}

function assertEqual(label: string, actual: number, expected: number) {
  if (roundCurrency(actual) !== roundCurrency(expected)) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

const prev = 10000;

assertEqual("no transfer", opening(prev, []), 10000);
assertEqual("bank → drawer", opening(prev, [tx("transfer", 2000, BANK, DRAWER)]), 12000);
assertEqual("drawer → bank", opening(prev, [tx("transfer", 2000, DRAWER, BANK)]), 8000);
assertEqual("expense from drawer", opening(prev, [tx("expense", 500, DRAWER, null)]), 10000);
assertEqual("income into drawer", opening(prev, [tx("income", 500, null, DRAWER)]), 10000);
assertEqual(
  "transfer + expense",
  opening(prev, [tx("transfer", 2000, BANK, DRAWER), tx("expense", 500, DRAWER, null)]),
  12000,
);
assertEqual(
  "multiple transfers net",
  opening(prev, [
    tx("transfer", 2000, BANK, DRAWER),
    tx("transfer", 500, DRAWER, BANK),
    tx("transfer", 300, BANK, DRAWER),
  ]),
  11800,
);
assertEqual("pigmi auto-post transfer ignored", opening(prev, [tx("transfer", 1000, DRAWER, "unity", { autoPostedSource: "daily_closing" })]), 10000);
assertEqual("voided transfer ignored", opening(prev, [tx("transfer", 2000, BANK, DRAWER, { status: "void" })]), 10000);

function viewOpening(locked: boolean, storedOpening: number, prevClosing: number, txs: ReturnType<typeof tx>[]) {
  if (locked) return storedOpening;
  return opening(prevClosing, txs);
}

assertEqual("locked day opening frozen after save", viewOpening(true, 12000, 10000, [tx("transfer", 9999, BANK, DRAWER)]), 12000);
assertEqual("unlocked day live-applies transfer", viewOpening(false, 10000, 10000, [tx("transfer", 2000, BANK, DRAWER)]), 12000);

function assertSame(label: string, actual: string, expected: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

assertSame("work date after last lock", dailyClosingWorkDate("2026-09-10", "2026-09-17"), "2026-09-11");
assertSame("work date is today when yesterday locked", dailyClosingWorkDate("2026-09-16", "2026-09-17"), "2026-09-17");
assertSame("work date stays today after today's close", dailyClosingWorkDate("2026-09-17", "2026-09-17"), "2026-09-17");
assertSame("first day is today", dailyClosingWorkDate(null, "2026-09-17"), "2026-09-17");
if (canEditDailyClosingDate("2026-09-17", "2026-09-10", "2026-09-17")) {
  throw new Error("skip-ahead date must not be editable");
}
if (!canEditDailyClosingDate("2026-09-11", "2026-09-10", "2026-09-17")) {
  throw new Error("day after last lock must be editable");
}

console.log("verify-opening-cash-rule: all cases passed");
