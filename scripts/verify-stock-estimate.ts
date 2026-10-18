/**
 * Verifies the Daily Closing stock rules (no Firestore), using the app's real
 * pure functions from lib/finance.ts:
 *   computeEstimatedSales        — sold × price + shawarmas × price
 *   expectedOpeningFromPrevious  — today's Opening = yesterday's Closing + Order
 *   unexplainedStockMismatches   — what blocks closing the day
 */
import {
  DEFAULT_STOCK_PRICING,
  computeEstimatedSales,
  expectedOpeningFromPrevious,
  unexplainedStockMismatches,
  type DailyClosingStockEntry,
} from "../lib/finance";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) {
    failures += 1;
    console.error(`FAIL ${label}${detail ? `: ${detail}` : ""}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

const price = (id: string) => DEFAULT_STOCK_PRICING.items.find((i) => i.id === id)!.unitPrice;
const row = (id: string, name: string, opening: number | null, closing: number | null, order: number | null, reason?: string): DailyClosingStockEntry => ({
  itemId: id,
  itemName: name,
  opening,
  closing,
  order,
  unitPrice: price(id),
  mismatchReason: reason ?? null,
});
const prices = DEFAULT_STOCK_PRICING.shawarmaPrices;
const noShawarma = { khubbusRoll: 0, khubbusPlate: 0, rumaliRoll: 0, rumaliPlate: 0 };

// The sheet from 15/10/2026, read as a normal day (Opening − Closing sold).
const day = [
  row("alfaham", "Alfaham", 7, 2.5, 5),
  row("grill", "Grill", 0, 0, null),
  row("tandoori", "Tandoori", 2, 2, null),
  row("tikka", "Tikka", 24, 11, 2),
  row("tandoori_kebab", "Tandoori Kebab", 11, 5, 2),
  row("boneless", "Boneless", 0, 0, null),
];
const est = computeEstimatedSales(day, { ...noShawarma, khubbusRoll: 100 }, prices);
// Alfaham 4.5×480=2160, Tikka 13×80=1040, Kebab 6×100=600 → 3800; Khubbus roll 100×60=6000
check("stock estimate = 3800", est.stockTotal === 3800, String(est.stockTotal));
check("shawarma estimate = 6000", est.shawarmaTotal === 6000, String(est.shawarmaTotal));
check("total = 9800", est.total === 9800, String(est.total));
check("half pieces count (Alfaham sold 4.5)", est.lines.find((l) => l.itemId === "alfaham")?.sold === 4.5);

// First day: only Closing + Order → nothing sold yet, no estimate, no mismatch.
const firstDay = day.map((r) => ({ ...r, opening: null }));
check("first day: no stock estimate", computeEstimatedSales(firstDay, noShawarma, prices).total === 0);
check("first day: nothing to validate", unexplainedStockMismatches(firstDay, expectedOpeningFromPrevious([])).length === 0);

// Chain: next day's Opening must equal Closing + Order.
const expected = expectedOpeningFromPrevious(day);
check("expected Alfaham opening = 2.5 + 5 = 7.5", expected.alfaham === 7.5, String(expected.alfaham));
check("expected Tikka opening = 11 + 2 = 13", expected.tikka === 13);
check("expected Tandoori opening = 2 + 0 (no order) = 2", expected.tandoori === 2);
const nextOk = [row("alfaham", "Alfaham", 7.5, 3, 4), row("tikka", "Tikka", 13, 5, 0)];
check("matching openings pass", unexplainedStockMismatches(nextOk, expected).length === 0);
const nextBad = [row("alfaham", "Alfaham", 7, 3, 4), row("tikka", "Tikka", 13, 5, 0)];
const bad = unexplainedStockMismatches(nextBad, expected);
check("mismatch without reason blocks", bad.length === 1 && bad[0].itemName === "Alfaham" && bad[0].expected === 7.5);
const explained = [row("alfaham", "Alfaham", 7, 3, 4, "half piece spoiled"), row("tikka", "Tikka", 13, 5, 0)];
check("mismatch with reason passes", unexplainedStockMismatches(explained, expected).length === 0);

// Unpriced (Boneless) and closing > opening are flagged, not counted.
const edge = computeEstimatedSales([row("boneless", "Boneless", 5, 2, null), row("tikka", "Tikka", 3, 4, null)], noShawarma, prices);
check("unpriced item excluded and flagged", edge.total === 0 && edge.unpricedItems.includes("Boneless"));
check("closing > opening counted as 0 and flagged", edge.negativeItems.includes("Tikka"));

// Quarters: 3¼ opening, ¾ closing → 2.5 sold; chain carries quarters exactly.
const quarter = computeEstimatedSales([row("alfaham", "Alfaham", 3.25, 0.75, 1.25)], noShawarma, prices);
check("quarter pieces (3.25 − 0.75 = 2.5 sold → 1200)", quarter.lines[0]?.sold === 2.5 && quarter.total === 1200, String(quarter.total));
check("quarter chain (0.75 + 1.25 = 2)", expectedOpeningFromPrevious([row("alfaham", "Alfaham", 3.25, 0.75, 1.25)]).alfaham === 2);
const q2 = computeEstimatedSales([row("tikka", "Tikka", 5.25, 2, null)], noShawarma, prices);
check("quarter sold (5.25 − 2 = 3.25 → 260)", q2.total === 260, String(q2.total));

// Price snapshot: a day keeps the price it was saved with.
const snap = computeEstimatedSales([{ ...row("tikka", "Tikka", 10, 0, null), unitPrice: 90 }], noShawarma, prices);
check("uses the day's own price snapshot", snap.total === 900);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll stock checks passed.");
