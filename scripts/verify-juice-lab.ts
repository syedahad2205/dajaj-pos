/**
 * Verifies Juice Lab never leaks into DAJAJ revenue, expense or profit
 * (no Firestore). Runs the app's real pure functions:
 *   computeDailyClosingTotals  — the day's totals (Daily Closing / Dashboard / P&L)
 *   dailyClosingPostingEvents  — what a closed day posts to the ledger
 *   pnlLedgerTransactions      — which ledger rows count toward P&L
 *
 * Each day is built the way it really happens: DAJAJ sells in cash + UPI,
 * Juice Lab sells in cash + UPI through the same till and UPI account, then
 * Juice Lab takes some cash from the drawer ("collected") and the rest is
 * pending (paid out of the UPI account). DAJAJ revenue must always equal
 * DAJAJ's own sales, whatever the Juice Lab split.
 *
 * JUICE LAB INVARIANT — this is the guard for the rules documented above
 * computeDailyClosingTotals in lib/finance.ts. Run it after touching any
 * revenue/UPI/ledger/P&L code; add a case here for any new scenario.
 */
import {
  computeDailyClosingTotals,
  dailyClosingPostingEvents,
  pnlLedgerTransactions,
  roundCurrency,
  type FinanceDailyClosing,
} from "../lib/finance";

const DRAWER = "cash-drawer";
const UPI = "upi-bank";
const PIGMI = "pigmi";

let failures = 0;
function assertEqual(label: string, actual: number, expected: number) {
  if (Math.abs(actual - expected) > 0.001) {
    failures += 1;
    console.error(`FAIL ${label}: got ${actual}, expected ${expected}`);
  }
}

interface Day {
  label: string;
  opening: number;
  dajajCash: number;
  dajajUpi: number;
  juiceCash: number;
  juiceUpi: number;
  collected: number; // cash Juice Lab took from the drawer
  expenses: number;
  pigmi: number;
}

function buildClosing(d: Day): FinanceDailyClosing {
  const juiceRevenue = d.juiceCash + d.juiceUpi;
  const closingCash = roundCurrency(d.opening + d.dajajCash + d.juiceCash - d.expenses - d.pigmi - d.collected);
  const base = {
    openingCash: d.opening,
    expenses: d.expenses > 0 ? [{ id: "e1", categoryId: "c", categoryName: "Veg", subcategoryId: null, subcategoryName: null, amount: d.expenses, remarks: "" }] : [],
    deposits: d.pigmi > 0 ? [{ id: "d1", type: "pigmi" as const, typeLabel: "Pigmi", amount: d.pigmi, remarks: "" }] : [],
    upiSales: roundCurrency(d.dajajUpi + d.juiceUpi),
    zomatoSales: 0,
    swiggySales: 0,
    otherIncome: 0,
    juiceLabRevenue: juiceRevenue,
    juiceLabCollected: d.collected,
    closingCash,
  };
  return { ...base, ...computeDailyClosingTotals(base) } as unknown as FinanceDailyClosing;
}

/** Turns posting events into ledger rows the way postDailyClosingToLedger maps accounts. */
function postLedger(closing: FinanceDailyClosing) {
  return dailyClosingPostingEvents(closing).map((e) => {
    const base = { amount: e.amount, autoPostedSource: "daily_closing" as string | null, status: "posted" };
    if (e.eventKey === "cash_sales") return { ...base, type: "income", fromAccountId: null, toAccountId: DRAWER, key: e.eventKey };
    if (e.eventKey === "upi_sales") return { ...base, type: "income", fromAccountId: null, toAccountId: UPI, key: e.eventKey };
    if (e.eventKey === "cash_expenses") return { ...base, type: "expense", fromAccountId: DRAWER, toAccountId: null, key: e.eventKey };
    if (e.eventKey === "juice_lab_payout") return { ...base, type: "expense", fromAccountId: UPI, toAccountId: null, key: e.eventKey };
    if (e.kind === "deposit") return { ...base, type: "transfer", fromAccountId: DRAWER, toAccountId: PIGMI, key: e.eventKey };
    throw new Error(`unexpected event ${e.eventKey}`);
  });
}

function accountDelta(rows: ReturnType<typeof postLedger>, account: string) {
  return roundCurrency(rows.reduce((s, t) => s + (t.toAccountId === account ? t.amount : 0) - (t.fromAccountId === account ? t.amount : 0), 0));
}

const days: Day[] = [
  { label: "no Juice Lab", opening: 1000, dajajCash: 5000, dajajUpi: 10000, juiceCash: 0, juiceUpi: 0, collected: 0, expenses: 500, pigmi: 500 },
  { label: "all collected in cash", opening: 1000, dajajCash: 5000, dajajUpi: 10000, juiceCash: 800, juiceUpi: 1200, collected: 2000, expenses: 500, pigmi: 500 },
  { label: "all pending", opening: 1000, dajajCash: 5000, dajajUpi: 10000, juiceCash: 800, juiceUpi: 1200, collected: 0, expenses: 500, pigmi: 500 },
  { label: "split 500 / 1500", opening: 1000, dajajCash: 5000, dajajUpi: 10000, juiceCash: 800, juiceUpi: 1200, collected: 500, expenses: 500, pigmi: 500 },
  { label: "pending > today's UPI", opening: 1000, dajajCash: 3000, dajajUpi: 500, juiceCash: 3000, juiceUpi: 2000, collected: 500, expenses: 0, pigmi: 0 },
  { label: "no UPI at all", opening: 3381, dajajCash: 2000, dajajUpi: 0, juiceCash: 700, juiceUpi: 0, collected: 0, expenses: 1599, pigmi: 500 },
];

for (const d of days) {
  const closing = buildClosing(d);
  const juiceRevenue = d.juiceCash + d.juiceUpi;
  const pending = juiceRevenue - d.collected;

  // 1. Day totals: DAJAJ revenue is exactly DAJAJ's own sales.
  assertEqual(`${d.label}: totalRevenue = DAJAJ cash + DAJAJ UPI`, closing.totalRevenue, d.dajajCash + d.dajajUpi);
  assertEqual(`${d.label}: juiceLabPending`, closing.juiceLabPending, pending);
  assertEqual(`${d.label}: upiNetSales = UPI − pending`, closing.upiNetSales, d.dajajUpi + d.juiceUpi - pending);

  // 2. Ledger: account balances move by exactly the real money.
  const ledger = postLedger(closing);
  assertEqual(`${d.label}: drawer ledger = physical closing − opening`, accountDelta(ledger, DRAWER), (closing.closingCash ?? 0) - d.opening);
  assertEqual(`${d.label}: UPI account = UPI received − Juice Lab pending`, accountDelta(ledger, UPI), d.dajajUpi + d.juiceUpi - pending);
  assertEqual(`${d.label}: Pigmi account = deposit`, accountDelta(ledger, PIGMI), d.pigmi);

  // 3. P&L as the report/dashboard compute it: closing totals + counted ledger rows.
  //    Add a real manual bank expense and an Owner Withdrawal the same day.
  const manual = [
    { type: "expense", amount: 300, fromAccountId: UPI, toAccountId: null, autoPostedSource: null, status: "posted", key: "rent" },
    { type: "owner_withdrawal", amount: 1000, fromAccountId: UPI, toAccountId: null, autoPostedSource: null, status: "posted", key: "withdrawal" },
  ];
  const isCashDrawer = (id: string | null) => id === DRAWER;
  const counted = pnlLedgerTransactions([...ledger, ...manual], isCashDrawer);
  const countedKeys = [...counted.income, ...counted.expense].map((t) => t.key).join(",");
  if (countedKeys !== "rent") {
    failures += 1;
    console.error(`FAIL ${d.label}: only the manual rent expense should count toward P&L, got [${countedKeys}]`);
  }
  const revenue = closing.totalRevenue + counted.income.reduce((s, t) => s + t.amount, 0);
  const expense = closing.cashExpenseTotal + counted.expense.reduce((s, t) => s + t.amount, 0);
  assertEqual(`${d.label}: P&L revenue`, revenue, d.dajajCash + d.dajajUpi);
  assertEqual(`${d.label}: P&L expense (cash expenses + rent, no Juice Lab)`, expense, d.expenses + 300);
  assertEqual(`${d.label}: P&L profit`, revenue - expense, d.dajajCash + d.dajajUpi - d.expenses - 300);

  console.log(
    `${failures === 0 ? "ok  " : "    "} ${d.label.padEnd(24)} revenue ${closing.totalRevenue} | UPI ours ${closing.upiNetSales} | Juice Lab ${juiceRevenue} (C ${d.collected} / P ${pending})`,
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll Juice Lab checks passed: revenue, ledger balances and P&L exclude Juice Lab in every case.");
