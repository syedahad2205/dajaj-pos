"use client";

import { useEffect, useMemo, useState } from "react";
import { auth } from "@/lib/firebase";
import { firebaseAuthedFetch } from "@/lib/firebaseAuthFetch";
import { requirePosStaff } from "@/lib/roleGuard";
import { getPosStaffProfileByEmail } from "@/lib/firestore";

interface InventoryRow {
  itemId: string;
  name: string;
  description: string;
  trackingMode: "aggregate" | "items";
  variants: Array<{ variantId: string; name: string; multiplier: number }>;
  openingStock: number | null;
  closingStock: number | null;
  sold: number;
  expectedClosing: number | null;
  variance: number | null;
}

function formatQuantity(value: number | null) {
  return value === null ? "—" : String(value);
}

function parseStockValue(raw: string) {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function stockToDraft(value: number | null) {
  return value === null || value === undefined ? "" : String(value);
}

type StockDrafts = Record<string, { opening: string; closing: string }>;

export default function InventoryPage() {
  const { authenticated, loading, role } = requirePosStaff();
  const [canManageInventory, setCanManageInventory] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [drafts, setDrafts] = useState<StockDrafts>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [status, setStatus] = useState("Loading inventory…");

  useEffect(() => {
    if (!authenticated || loading) return;
    if (role === "admin") {
      setCanManageInventory(true);
      return;
    }

    const email = auth.currentUser?.email;
    if (!email) {
      setCanManageInventory(false);
      return;
    }

    void getPosStaffProfileByEmail(email).then((profile) => {
      setCanManageInventory(Boolean(profile?.canManageInventory));
    }).catch(() => setCanManageInventory(false));
  }, [authenticated, loading, role]);

  useEffect(() => {
    if (!authenticated || loading) return;
    if (!canManageInventory && role !== "admin") {
      setStatus("You do not have permission to manage inventory.");
      setRows([]);
      setDrafts({});
      return;
    }

    setStatus("Loading inventory…");
    void firebaseAuthedFetch(`/api/inventory/${date}`)
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.message || "Failed to load inventory report.");
        }
        return response.json();
      })
      .then((payload) => {
        if (!payload.success) {
          throw new Error(payload.message || "Failed to load inventory report.");
        }
        const mapped: InventoryRow[] = payload.report.items.map((item: any) => ({
          itemId: item.itemId,
          name: item.name,
          description: item.description,
          trackingMode: item.trackingMode,
          variants: item.variants,
          openingStock: item.openingStock,
          closingStock: item.closingStock,
          sold: item.sold,
          expectedClosing: item.expectedClosing,
          variance: item.variance,
        }));
        setRows(mapped);
        setDrafts(
          Object.fromEntries(
            mapped.map((r) => [
              r.itemId,
              { opening: stockToDraft(r.openingStock), closing: stockToDraft(r.closingStock) },
            ]),
          ),
        );
        setStatus("");
      })
      .catch((error: Error) => {
        setStatus(error.message || "Unable to load inventory.");
      });
  }, [authenticated, canManageInventory, date, loading, role]);

  const updateDraft = (itemId: string, part: "opening" | "closing", value: string) => {
    setDrafts((current) => ({
      ...current,
      [itemId]: {
        opening: part === "opening" ? value : (current[itemId]?.opening ?? ""),
        closing: part === "closing" ? value : (current[itemId]?.closing ?? ""),
      },
    }));
  };

  const handleSave = async (itemId: string, field: "openingStock" | "closingStock") => {
    const draft = drafts[itemId];
    const rawValue = field === "openingStock" ? (draft?.opening ?? "") : (draft?.closing ?? "");
    const trimmed = rawValue.trim();
    if (trimmed === "") {
      setStatus("Enter a number before saving.");
      return;
    }
    const value = parseStockValue(rawValue);
    if (value === null) {
      setStatus("That is not a valid number.");
      return;
    }

    const key = `${itemId}:${field}`;
    setSavingKey(key);
    setStatus("");
    try {
      const response = await firebaseAuthedFetch(`/api/inventory/${field === "openingStock" ? "opening" : "closing"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          itemId,
          [field]: value,
        }),
      });

      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.message || "Failed to save inventory.");
      }

      setRows((current) => current.map((row) => {
        if (row.itemId !== itemId) return row;
        if (field === "openingStock") {
          const openingStock = value;
          const expectedClosing = Number((openingStock - row.sold).toFixed(3));
          const variance = row.closingStock !== null ? Number((expectedClosing - row.closingStock).toFixed(3)) : null;
          return { ...row, openingStock, expectedClosing, variance };
        }
        if (field === "closingStock") {
          const closingStock = value;
          const variance = row.expectedClosing !== null ? Number((row.expectedClosing - closingStock).toFixed(3)) : null;
          return { ...row, closingStock, variance };
        }
        return row;
      }));
      setDrafts((current) => ({
        ...current,
        [itemId]: {
          opening: field === "openingStock" ? String(value) : (current[itemId]?.opening ?? ""),
          closing: field === "closingStock" ? String(value) : (current[itemId]?.closing ?? ""),
        },
      }));
      setStatus("Saved successfully.");
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : "Failed to save inventory.");
    } finally {
      setSavingKey(null);
    }
  };

  const activeDate = useMemo(() => new Date(date), [date]);

  if (loading) {
    return (
      <main className="min-h-screen bg-[#fff8ed] px-4 py-10 text-slate-900">
        <div className="mx-auto max-w-4xl rounded-[28px] border border-orange-200 bg-white p-10 text-center shadow-sm">
          Loading inventory access…
        </div>
      </main>
    );
  }

  if (!authenticated) return null;

  if (!canManageInventory && role !== "admin") {
    return (
      <main className="min-h-screen bg-[#fff8ed] px-4 py-10 text-slate-900">
        <div className="mx-auto max-w-4xl rounded-[28px] border border-orange-200 bg-white p-10 text-center shadow-sm">
          <h1 className="text-3xl font-black">Inventory Access Denied</h1>
          <p className="mt-4 text-sm text-slate-600">You are not authorized to manage inventory.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.28em] text-orange-600">Inventory</p>
              <h1 className="mt-2 text-4xl font-black">Menu-Based Inventory</h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Track opening and closing stock for menu items with sales derived from billed POS orders.
              </p>
            </div>
            <div className="space-y-2 text-right">
              <label className="block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Date</label>
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-orange-500"
              />
            </div>
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <section className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-2xl font-black">Stock entries</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Enter opening and closing stock, then use <strong>Save</strong> for each field. Nothing is sent until you save.
                </p>
              </div>
              <p className="text-sm text-slate-500">Current date: {activeDate.toLocaleDateString()}</p>
            </div>

            {status ? (
              <div className="mb-4 rounded-2xl border border-orange-100 bg-orange-50 px-4 py-3 text-sm text-slate-700">
                {status}
              </div>
            ) : null}

            <div className="space-y-4">
              {rows.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 py-14 text-center text-sm text-slate-500">
                  No inventory items found for this date. Enable inventory tracking on top-level categories in Menu Builder.
                </div>
              ) : rows.map((row) => {
                const rowSaving = savingKey?.startsWith(`${row.itemId}:`) ?? false;
                return (
                <div key={row.itemId} className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] xl:items-start">
                    <div className="min-w-0">
                      <h3 className="text-lg font-black text-slate-900">{row.name}</h3>
                      <p className="mt-1 text-sm text-slate-600">{row.description || "Menu item"}</p>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {row.trackingMode === "aggregate" ? (
                          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-slate-600">
                            Whole category × {row.variants[0]?.multiplier ?? 1}
                          </span>
                        ) : row.variants.length === 0 ? (
                          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                            No tracked items mapped yet
                          </span>
                        ) : row.variants.map((variant) => (
                          <span
                            key={variant.variantId}
                            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-slate-600"
                          >
                            {variant.name} × {variant.multiplier}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                      <div className="grid gap-2">
                        <label className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Opening stock</label>
                        <input
                          type="number"
                          step="0.25"
                          value={drafts[row.itemId]?.opening ?? ""}
                          onChange={(event) => updateDraft(row.itemId, "opening", event.target.value)}
                          className="w-full min-w-0 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-orange-500"
                        />
                        <button
                          type="button"
                          disabled={rowSaving}
                          onClick={() => void handleSave(row.itemId, "openingStock")}
                          className="rounded-2xl bg-orange-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {savingKey === `${row.itemId}:openingStock` ? "Saving…" : "Save opening"}
                        </button>
                      </div>
                      <div className="grid gap-2">
                        <label className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Closing stock</label>
                        <input
                          type="number"
                          step="0.25"
                          value={drafts[row.itemId]?.closing ?? ""}
                          onChange={(event) => updateDraft(row.itemId, "closing", event.target.value)}
                          className="w-full min-w-0 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-orange-500"
                        />
                        <button
                          type="button"
                          disabled={rowSaving}
                          onClick={() => void handleSave(row.itemId, "closingStock")}
                          className="rounded-2xl bg-orange-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {savingKey === `${row.itemId}:closingStock` ? "Saving…" : "Save closing"}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-4">
                    <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700">
                      <p className="font-semibold text-slate-900">Sold</p>
                      <p className="mt-2 text-lg font-black">{formatQuantity(row.sold)}</p>
                    </div>
                    <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700">
                      <p className="font-semibold text-slate-900">Expected closing</p>
                      <p className="mt-2 text-lg font-black">{formatQuantity(row.expectedClosing)}</p>
                    </div>
                    <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700">
                      <p className="font-semibold text-slate-900">Variance</p>
                      <p className="mt-2 text-lg font-black">{formatQuantity(row.variance)}</p>
                    </div>
                    <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700">
                      <p className="font-semibold text-slate-900">Tracking mode</p>
                      <p className="mt-2 text-lg font-black">
                        {row.trackingMode === "aggregate"
                          ? "Whole category"
                          : row.variants.length <= 1
                            ? "Individual item"
                            : `${row.variants.length} items`}
                      </p>
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          </section>

          <aside className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-black">How it works</h2>
            <div className="mt-4 space-y-4 text-sm leading-6 text-slate-600">
              <p><strong>Top-level categories</strong> become stock rows only when Track Inventory is enabled in Menu Builder, the category is available, and child items you track are available.</p>
              <p><strong>Whole category</strong> mode counts every child item sale against one shared stock bucket.</p>
              <p><strong>Individual items</strong> mode lets you choose which child items count, what multiplier each uses, and gives each tracked item its own opening and closing row.</p>
              <p>Sales are calculated from billed POS orders for the selected date. Modifier choices (e.g. Half) can use their own stock factor in Menu Builder.</p>
              <p>Expected closing = opening stock − sold. Variance = expected closing − actual closing.</p>
              <p>Use <strong>Save opening</strong> and <strong>Save closing</strong> on each row; edits are not stored until you press them.</p>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
