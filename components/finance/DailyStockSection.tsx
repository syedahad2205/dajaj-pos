"use client";

import { useEffect, useState } from "react";
import { firebaseAuthedFetch } from "@/lib/firebaseAuthFetch";
import { formatCurrency } from "@/lib/financeFormat";
import {
  AGGREGATOR_MARKUP_PCT,
  SHAWARMA_KINDS,
  computeEstimatedSales,
  revenueAtMenuPrices,
  roundCurrency,
  type DailyClosingStockEntry,
  type EstimatedSales,
  type ShawarmaCounts,
  type ShawarmaPrices,
  type StockItemConfig,
  type StockPricingConfig,
} from "@/lib/finance";
import Modal from "@/components/finance/Modal";

// ─────────────────────────────────────────────────────────────────────────
// Daily Closing → Stock section. Opening / Closing / Order per item plus
// shawarmas sold. Opening is pre-filled from yesterday's Closing + Order; a
// different value needs a reason before the day can close (enforced by
// closeDailyClosing). Estimated sales = sold × price, compared with the
// day's Total Revenue. Rules: lib/finance.ts (above DailyClosingStockEntry).
// ─────────────────────────────────────────────────────────────────────────

interface StockView {
  date: string;
  locked: boolean;
  config: StockPricingConfig;
  stock: DailyClosingStockEntry[];
  shawarmaSold: ShawarmaCounts;
  shawarmaPrices: ShawarmaPrices | null;
  estimatedSales: EstimatedSales;
  expectedOpening: Record<string, number | null>;
  hasPreviousStock: boolean;
}

interface RowDraft {
  opening: string;
  closing: string;
  order: string;
  reason: string;
}

async function readJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) throw new Error(payload?.message || "Request failed.");
  return payload;
}

const toNum = (v: string): number | null => (v.trim() === "" ? null : Number(v));
const fmtQty = (n: number | null | undefined) => (n === null || n === undefined ? "—" : String(n));

export default function DailyStockSection({
  date,
  locked,
  isAdmin,
  totalRevenue,
  zomatoSales,
  swiggySales,
  refreshKey,
  sectionNumber,
}: {
  date: string;
  locked: boolean;
  isAdmin: boolean;
  /** Live Total Revenue from the page (null until Closing Cash is entered). */
  totalRevenue: number | null;
  /** Live Zomato / Swiggy Sales from the page — their markup is removed before comparing. */
  zomatoSales: number;
  swiggySales: number;
  /** Bump to reload (e.g. after Read from Image applied stock). */
  refreshKey: number;
  sectionNumber: number;
}) {
  const [view, setView] = useState<StockView | null>(null);
  const [rows, setRows] = useState<Record<string, RowDraft>>({});
  const [shawarma, setShawarma] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pricesOpen, setPricesOpen] = useState(false);

  const applyView = (v: StockView) => {
    setView(v);
    const byId = new Map(v.stock.map((r) => [r.itemId, r]));
    const next: Record<string, RowDraft> = {};
    for (const item of v.config.items) {
      const saved = byId.get(item.id);
      const expected = v.expectedOpening[item.id];
      // Pre-fill Opening from yesterday's Closing + Order when not saved yet.
      const opening = saved?.opening ?? (typeof expected === "number" ? expected : null);
      next[item.id] = {
        opening: opening === null ? "" : String(opening),
        closing: saved?.closing === null || saved?.closing === undefined ? "" : String(saved.closing),
        order: saved?.order === null || saved?.order === undefined ? "" : String(saved.order),
        reason: saved?.mismatchReason ?? "",
      };
    }
    setRows(next);
    setShawarma(Object.fromEntries(SHAWARMA_KINDS.map((k) => [k.key, String(v.shawarmaSold[k.key] ?? 0)])));
  };

  const load = async () => {
    setError("");
    try {
      const payload = await readJson(await firebaseAuthedFetch(`/api/finance/closing/${date}/stock`));
      applyView(payload.view);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stock.");
    }
  };

  useEffect(() => {
    if (date) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, refreshKey]);

  if (!view) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{sectionNumber}. Stock &amp; Shawarmas</p>
        <p className="mt-2 text-sm text-slate-500">{error || "Loading stock…"}</p>
      </section>
    );
  }

  // Items to show: active items, plus inactive ones that already have numbers today.
  const savedIds = new Set(view.stock.map((r) => r.itemId));
  const items: StockItemConfig[] = view.config.items.filter((i) => i.active || savedIds.has(i.id));
  const firstDay = !view.hasPreviousStock;
  const disabled = locked || view.locked || saving;

  // Live estimate from the drafts, using today's prices (what a save will snapshot).
  const priceOf = (itemId: string) =>
    view.locked ? view.stock.find((r) => r.itemId === itemId)?.unitPrice ?? null : view.config.items.find((i) => i.id === itemId)?.unitPrice ?? null;
  const draftStock: DailyClosingStockEntry[] = items.map((i) => ({
    itemId: i.id,
    itemName: i.name,
    opening: toNum(rows[i.id]?.opening ?? ""),
    closing: toNum(rows[i.id]?.closing ?? ""),
    order: toNum(rows[i.id]?.order ?? ""),
    unitPrice: priceOf(i.id),
  }));
  const draftShawarma = Object.fromEntries(SHAWARMA_KINDS.map((k) => [k.key, Number(shawarma[k.key]) || 0])) as unknown as ShawarmaCounts;
  const prices = view.locked ? view.shawarmaPrices : view.config.shawarmaPrices;
  const estimate = computeEstimatedSales(draftStock, draftShawarma, prices);

  const save = async () => {
    if (disabled) return;
    setSaving(true);
    setError("");
    try {
      const payload = await readJson(
        await firebaseAuthedFetch(`/api/finance/closing/${date}/stock`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rows: items.map((i) => ({
              itemId: i.id,
              opening: toNum(rows[i.id]?.opening ?? ""),
              closing: toNum(rows[i.id]?.closing ?? ""),
              order: toNum(rows[i.id]?.order ?? ""),
              mismatchReason: rows[i.id]?.reason ?? "",
            })),
            shawarmaSold: draftShawarma,
          }),
        }),
      );
      applyView(payload.view);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save stock.");
    } finally {
      setSaving(false);
    }
  };

  const setRow = (id: string, patch: Partial<RowDraft>) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
  const cell = "w-full min-w-0 rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-orange-400 disabled:bg-slate-50";
  // Compare like with like: the estimate uses menu prices, so strip the
  // aggregator markup from Zomato/Swiggy sales first (Daily Closing only).
  const atMenu = totalRevenue !== null ? revenueAtMenuPrices(totalRevenue, zomatoSales, swiggySales) : null;
  const difference = atMenu !== null ? roundCurrency(atMenu.comparable - estimate.total) : null;
  const differencePct = difference !== null && estimate.total > 0 ? Math.round((difference / estimate.total) * 100) : null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{sectionNumber}. Stock &amp; Shawarmas</p>
        {isAdmin ? (
          <button type="button" onClick={() => setPricesOpen(true)} className="text-xs font-semibold text-orange-600 underline">
            Edit items, prices &amp; salaries
          </button>
        ) : null}
      </div>
      {firstDay ? (
        <p className="mb-3 rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-800">
          First day of stock tracking: just enter Closing and Order. From tomorrow, Opening fills in as today&apos;s Closing + Order.
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <tr>
              <th className="py-1.5 pr-2">Item</th>
              <th className="px-1 py-1.5">Opening</th>
              <th className="px-1 py-1.5">Closing</th>
              <th className="px-1 py-1.5">Order</th>
              <th className="px-1 py-1.5 text-right">Sold</th>
              <th className="py-1.5 pl-2 text-right">Est. ₹</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {items.map((item) => {
              const r = rows[item.id] ?? { opening: "", closing: "", order: "", reason: "" };
              const expected = view.expectedOpening[item.id];
              const opening = toNum(r.opening);
              const mismatch = typeof expected === "number" && opening !== null && Math.abs(opening - expected) > 0.001;
              const line = estimate.lines.find((l) => l.itemId === item.id);
              const price = priceOf(item.id);
              return (
                <tr key={item.id} className="align-top">
                  <td className="py-2 pr-2">
                    <span className="font-semibold text-slate-800">{item.name}</span>
                    <span className="block text-[11px] text-slate-400">{price === null ? "price not set" : `${formatCurrency(price)} / pc`}</span>
                  </td>
                  <td className="px-1 py-2">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.25"
                      min="0"
                      disabled={disabled}
                      value={r.opening}
                      placeholder={firstDay ? "—" : ""}
                      onChange={(e) => setRow(item.id, { opening: e.target.value })}
                      onBlur={save}
                      className={`${cell} ${mismatch ? "border-rose-400 bg-rose-50" : ""}`}
                    />
                    {typeof expected === "number" ? (
                      <span className={`block text-[11px] ${mismatch ? "font-semibold text-rose-600" : "text-slate-400"}`}>expected {expected}</span>
                    ) : null}
                  </td>
                  <td className="px-1 py-2">
                    <input type="number" inputMode="decimal" step="0.25" min="0" disabled={disabled} value={r.closing} onChange={(e) => setRow(item.id, { closing: e.target.value })} onBlur={save} className={cell} />
                  </td>
                  <td className="px-1 py-2">
                    <input type="number" inputMode="decimal" step="0.25" min="0" disabled={disabled} value={r.order} onChange={(e) => setRow(item.id, { order: e.target.value })} onBlur={save} className={cell} />
                  </td>
                  <td className="px-1 py-2 text-right font-semibold text-slate-700">{line ? fmtQty(line.sold) : "—"}</td>
                  <td className="py-2 pl-2 text-right text-slate-700">{line && price !== null ? formatCurrency(line.amount) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {items.some((i) => {
        const exp = view.expectedOpening[i.id];
        const o = toNum(rows[i.id]?.opening ?? "");
        return typeof exp === "number" && o !== null && Math.abs(o - exp) > 0.001;
      }) ? (
        <div className="mt-3 space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-3">
          <p className="text-xs font-semibold text-rose-700">Opening doesn&apos;t match yesterday&apos;s Closing + Order — add a reason to close the day.</p>
          {items.map((i) => {
            const exp = view.expectedOpening[i.id];
            const o = toNum(rows[i.id]?.opening ?? "");
            if (!(typeof exp === "number" && o !== null && Math.abs(o - exp) > 0.001)) return null;
            return (
              <label key={i.id} className="block text-xs text-slate-700">
                <span className="font-semibold">
                  {i.name}: {o} (expected {exp})
                </span>
                <input
                  disabled={disabled}
                  value={rows[i.id]?.reason ?? ""}
                  onChange={(e) => setRow(i.id, { reason: e.target.value })}
                  onBlur={save}
                  placeholder="e.g. 1 spoiled, delivery short by 2"
                  maxLength={200}
                  className={`mt-1 ${cell}`}
                />
              </label>
            );
          })}
        </div>
      ) : null}

      <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Total shawarmas sold</p>
      <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {SHAWARMA_KINDS.map((k) => (
          <label key={k.key} className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-500">
              {k.label} <span className="font-normal text-slate-400">· {formatCurrency(prices?.[k.key] ?? 0)}</span>
            </span>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              disabled={disabled}
              value={shawarma[k.key] ?? "0"}
              onChange={(e) => setShawarma((s) => ({ ...s, [k.key]: e.target.value }))}
              onBlur={save}
              className={cell}
            />
          </label>
        ))}
      </div>

      {/* Estimated sales vs Total Revenue */}
      <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm">
        <div className="flex justify-between py-0.5">
          <span className="text-slate-500">Estimated from stock</span>
          <span className="font-semibold">{formatCurrency(estimate.stockTotal)}</span>
        </div>
        <div className="flex justify-between py-0.5">
          <span className="text-slate-500">Estimated from shawarmas</span>
          <span className="font-semibold">{formatCurrency(estimate.shawarmaTotal)}</span>
        </div>
        <div className="flex justify-between border-t border-slate-200 py-1">
          <span className="font-semibold text-slate-700">Estimated sales</span>
          <span className="font-black">{formatCurrency(estimate.total)}</span>
        </div>
        <div className="flex justify-between py-0.5">
          <span className="text-slate-500">Total Revenue (actual)</span>
          <span className="font-semibold">{totalRevenue !== null ? formatCurrency(totalRevenue) : "— (enter Closing Cash)"}</span>
        </div>
        {atMenu !== null && atMenu.markupRemoved > 0 ? (
          <>
            <div className="flex justify-between py-0.5">
              <span className="text-slate-500">− Zomato/Swiggy markup ({AGGREGATOR_MARKUP_PCT}%)</span>
              <span className="font-semibold">{formatCurrency(atMenu.markupRemoved)}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-slate-500">Revenue at menu prices</span>
              <span className="font-semibold">{formatCurrency(atMenu.comparable)}</span>
            </div>
          </>
        ) : null}
        {difference !== null ? (
          <div className="flex justify-between py-0.5">
            <span className="text-slate-500">Difference (actual − estimated)</span>
            <span className={`font-bold ${difference < 0 ? "text-rose-600" : "text-emerald-600"}`}>
              {difference > 0 ? "+" : ""}
              {formatCurrency(difference)}
              {differencePct !== null ? ` (${differencePct > 0 ? "+" : ""}${differencePct}%)` : ""}
            </span>
          </div>
        ) : null}
        {estimate.unpricedItems.length > 0 ? (
          <p className="mt-1 text-xs text-amber-700">No price set for {estimate.unpricedItems.join(", ")} — not included in the estimate.</p>
        ) : null}
        {estimate.negativeItems.length > 0 ? (
          <p className="mt-1 text-xs text-amber-700">Closing is more than Opening for {estimate.negativeItems.join(", ")} — counted as 0 sold.</p>
        ) : null}
      </div>

      {saving ? <p className="mt-2 text-xs text-slate-400">Saving…</p> : null}
      {error ? <p className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{error}</p> : null}

      {pricesOpen ? (
        <StockPricesModal
          config={view.config}
          onClose={() => setPricesOpen(false)}
          onSaved={async () => {
            setPricesOpen(false);
            await load();
          }}
        />
      ) : null}
    </section>
  );
}

function StockPricesModal({ config, onClose, onSaved }: { config: StockPricingConfig; onClose: () => void; onSaved: () => void }) {
  const [items, setItems] = useState(config.items.map((i) => ({ ...i, price: i.unitPrice === null ? "" : String(i.unitPrice) })));
  const [shawarma, setShawarma] = useState<Record<string, string>>(
    Object.fromEntries(SHAWARMA_KINDS.map((k) => [k.key, String(config.shawarmaPrices[k.key])])),
  );
  const [staff, setStaff] = useState((config.staff ?? []).map((p) => ({ ...p, salary: p.dailySalary === null ? "" : String(p.dailySalary) })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const input = "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-400";

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      await readJson(
        await firebaseAuthedFetch("/api/finance/stock-config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: items.map((i) => ({ id: i.id, name: i.name, unitPrice: i.price.trim() === "" ? null : Number(i.price), active: i.active })),
            shawarmaPrices: Object.fromEntries(SHAWARMA_KINDS.map((k) => [k.key, Number(shawarma[k.key])])),
            staff: staff.map((p) => ({ id: p.id, name: p.name, dailySalary: p.salary.trim() === "" ? null : Number(p.salary), active: p.active })),
          }),
        }),
      );
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save prices.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Stock, prices & salaries" subtitle="Prices feed estimated sales (days saved from now on). Salaries fill ticked salary rows in Read from Image." onClose={() => !saving && onClose()}>
      <div className="space-y-4">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Stock items (₹ per piece)</p>
          {items.map((item, index) => (
            <div key={item.id || `new-${index}`} className="grid grid-cols-[1fr_7rem_auto] items-center gap-2">
              <input value={item.name} onChange={(e) => setItems((list) => list.map((x, j) => (j === index ? { ...x, name: e.target.value } : x)))} className={input} placeholder="Item name" />
              <input
                type="number"
                inputMode="decimal"
                min="0"
                value={item.price}
                onChange={(e) => setItems((list) => list.map((x, j) => (j === index ? { ...x, price: e.target.value } : x)))}
                className={input}
                placeholder="not set"
              />
              <label className="flex items-center gap-1 text-xs text-slate-600">
                <input type="checkbox" checked={item.active} onChange={(e) => setItems((list) => list.map((x, j) => (j === index ? { ...x, active: e.target.checked } : x)))} />
                Active
              </label>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setItems((list) => [...list, { id: "", name: "", unitPrice: null, price: "", active: true, displayOrder: list.length + 1 }])}
            className="text-xs font-semibold text-orange-600 underline"
          >
            + Add item
          </button>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Shawarma prices (₹ each)</p>
          <div className="grid grid-cols-2 gap-2">
            {SHAWARMA_KINDS.map((k) => (
              <label key={k.key} className="block text-xs font-semibold text-slate-500">
                {k.label}
                <input type="number" inputMode="decimal" min="0" value={shawarma[k.key]} onChange={(e) => setShawarma((s) => ({ ...s, [k.key]: e.target.value }))} className={`mt-1 ${input}`} />
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Staff daily salary (₹)</p>
          <p className="text-xs text-slate-500">Used by Read from Image: a ticked PAID box with no amount on the sheet uses this salary.</p>
          {staff.map((person, index) => (
            <div key={person.id || `staff-${index}`} className="grid grid-cols-[1fr_7rem_auto] items-center gap-2">
              <input value={person.name} onChange={(e) => setStaff((list) => list.map((x, j) => (j === index ? { ...x, name: e.target.value } : x)))} className={input} placeholder="Name" />
              <input
                type="number"
                inputMode="decimal"
                min="0"
                value={person.salary}
                onChange={(e) => setStaff((list) => list.map((x, j) => (j === index ? { ...x, salary: e.target.value } : x)))}
                className={input}
                placeholder="not set"
              />
              <label className="flex items-center gap-1 text-xs text-slate-600">
                <input type="checkbox" checked={person.active} onChange={(e) => setStaff((list) => list.map((x, j) => (j === index ? { ...x, active: e.target.checked } : x)))} />
                Active
              </label>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setStaff((list) => [...list, { id: "", name: "", dailySalary: null, salary: "", active: true }])}
            className="text-xs font-semibold text-orange-600 underline"
          >
            + Add staff member
          </button>
        </div>

        {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" disabled={saving} onClick={onClose} className="rounded-2xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Cancel
          </button>
          <button type="button" disabled={saving} onClick={handleSave} className="rounded-2xl bg-orange-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50">
            {saving ? "Saving…" : "Save prices"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
