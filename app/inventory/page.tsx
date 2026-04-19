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
type EditedFields = Record<string, { opening: boolean; closing: boolean }>;
type OriginalStocks = Record<string, { opening: number | null; closing: number | null }>;

export default function InventoryPage() {
  const { authenticated, loading, role } = requirePosStaff();
  const [canManageInventory, setCanManageInventory] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [drafts, setDrafts] = useState<StockDrafts>({});
  const [originalStocks, setOriginalStocks] = useState<OriginalStocks>({});
  const [editedFields, setEditedFields] = useState<EditedFields>({});
  const [saving, setSaving] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
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
        const initialDrafts = Object.fromEntries(
          mapped.map((r) => [
            r.itemId,
            { opening: stockToDraft(r.openingStock), closing: stockToDraft(r.closingStock) },
          ]),
        );
        setDrafts(initialDrafts);
        setOriginalStocks(
          Object.fromEntries(
            mapped.map((r) => [
              r.itemId,
              { opening: r.openingStock, closing: r.closingStock },
            ]),
          ),
        );
        setEditedFields({});
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
    const original = originalStocks[itemId]?.[part];
    const newValue = parseStockValue(value);
    const isEdited = newValue !== original;
    setEditedFields((current) => ({
      ...current,
      [itemId]: {
        opening: part === "opening" ? isEdited : (current[itemId]?.opening ?? false),
        closing: part === "closing" ? isEdited : (current[itemId]?.closing ?? false),
      },
    }));
  };

  const handleSaveAll = async () => {
    const changes: Array<{ itemId: string; field: "openingStock" | "closingStock"; value: number }> = [];
    for (const [itemId, edited] of Object.entries(editedFields)) {
      if (edited.opening) {
        const value = parseStockValue(drafts[itemId]?.opening ?? "");
        if (value !== null) changes.push({ itemId, field: "openingStock", value });
      }
      if (edited.closing) {
        const value = parseStockValue(drafts[itemId]?.closing ?? "");
        if (value !== null) changes.push({ itemId, field: "closingStock", value });
      }
    }
    if (changes.length === 0) {
      setStatus("No changes to save.");
      return;
    }
    setSaving(true);
    setStatus("");
    try {
      // Save all changes
      const promises = changes.map(({ itemId, field, value }) =>
        firebaseAuthedFetch(`/api/inventory/${field === "openingStock" ? "opening" : "closing"}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date, itemId, [field]: value }),
        }).then(async (response) => {
          if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw new Error(body?.message || `Failed to save ${field} for ${itemId}.`);
          }
          return response.json();
        })
      );
      await Promise.all(promises);
      // Update rows
      setRows((current) =>
        current.map((row) => {
          const itemChanges = changes.filter((c) => c.itemId === row.itemId);
          let updatedRow = { ...row };
          for (const change of itemChanges) {
            if (change.field === "openingStock") {
              updatedRow.openingStock = change.value;
              updatedRow.expectedClosing = Number((change.value - row.sold).toFixed(3));
              updatedRow.variance = row.closingStock !== null ? Number((updatedRow.expectedClosing - row.closingStock).toFixed(3)) : null;
            } else if (change.field === "closingStock") {
              updatedRow.closingStock = change.value;
              updatedRow.variance = updatedRow.expectedClosing !== null ? Number((updatedRow.expectedClosing - change.value).toFixed(3)) : null;
            }
          }
          return updatedRow;
        })
      );
      // Update originals and reset edited
      setOriginalStocks((current) => {
        const newOriginals = { ...current };
        for (const change of changes) {
          if (!newOriginals[change.itemId]) newOriginals[change.itemId] = { opening: null, closing: null };
          newOriginals[change.itemId][change.field === "openingStock" ? "opening" : "closing"] = change.value;
        }
        return newOriginals;
      });
      setEditedFields({});
      setStatus("All changes saved successfully.");
      setShowReviewModal(false);
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : "Failed to save inventory.");
    } finally {
      setSaving(false);
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
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-4">
              <p className="text-sm font-semibold uppercase tracking-[0.28em] text-orange-600">Inventory</p>
              <div className="space-y-2">
                <h1 className="text-4xl font-black tracking-tight text-slate-900">Menu-Based Inventory</h1>
                <p className="max-w-2xl text-sm leading-6 text-slate-600">
                  Track opening and closing stock for menu items with sales derived from billed POS orders.
                </p>
              </div>
            </div>
            <div className="flex max-w-[320px] flex-col gap-2">
              <label className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Date</label>
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-orange-500"
              />
            </div>
          </div>
        </header>

        <div className="grid gap-4">
          <section className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-2xl font-black">Stock entries</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Enter opening and closing stock. Changes are retained until you save all at once.
                </p>
              </div>
              <button
                onClick={() => setShowReviewModal(true)}
                disabled={Object.keys(editedFields).length === 0 || saving}
                className="rounded-2xl bg-orange-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save All Changes"}
              </button>
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
                return (
                <div key={row.itemId} className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] xl:items-start">
                    <div className="min-w-0">
                      <h3 className="text-lg font-black text-slate-900">{row.name}</h3>
                      <p className="mt-1 text-sm text-slate-600">{row.description || "Menu item"}</p>

                    </div>

                    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                      <div className="grid gap-2">
                        <label className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Opening stock</label>
                        <input
                          type="number"
                          step="0.25"
                          value={drafts[row.itemId]?.opening ?? ""}
                          onChange={(event) => updateDraft(row.itemId, "opening", event.target.value)}
                          className={`w-full min-w-0 rounded-2xl border px-4 py-3 text-sm outline-none focus:border-orange-500 ${
                            editedFields[row.itemId]?.opening ? "border-orange-400 bg-orange-50" : "border-slate-300 bg-white"
                          }`}
                        />
                      </div>
                      <div className="grid gap-2">
                        <label className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Closing stock</label>
                        <input
                          type="number"
                          step="0.25"
                          value={drafts[row.itemId]?.closing ?? ""}
                          onChange={(event) => updateDraft(row.itemId, "closing", event.target.value)}
                          className={`w-full min-w-0 rounded-2xl border px-4 py-3 text-sm outline-none focus:border-orange-500 ${
                            editedFields[row.itemId]?.closing ? "border-orange-400 bg-orange-50" : "border-slate-300 bg-white"
                          }`}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700">
                      <p className="font-semibold text-slate-900">Sold</p>
                      <p className="mt-2 text-lg font-black">{formatQuantity(row.sold)}</p>
                    </div>
                    <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700">
                      <p className="font-semibold text-slate-900">Expected closing</p>
                      <p className="mt-2 text-lg font-black">{formatQuantity(row.expectedClosing)}</p>
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* Review Modal */}
        {showReviewModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="max-h-[80vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
              <div className="mb-6">
                <h2 className="text-2xl font-black">Review Changes</h2>
                <p className="mt-2 text-sm text-slate-600">Confirm the following stock updates before saving.</p>
              </div>
              <div className="space-y-4">
                {Object.entries(editedFields).map(([itemId, edited]) => {
                  const row = rows.find((r) => r.itemId === itemId);
                  if (!row) return null;
                  const original = originalStocks[itemId];
                  const draft = drafts[itemId];
                  return (
                    <div key={itemId} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <h3 className="font-bold text-slate-900">{row.name}</h3>
                      <div className="mt-3 grid gap-4 sm:grid-cols-2">
                        {edited.opening && (
                          <div>
                            <p className="text-sm font-semibold text-slate-700">Opening Stock</p>
                            <div className="mt-1 flex gap-2 text-sm">
                              <span className="text-slate-500">From: {formatQuantity(original?.opening)}</span>
                              <span className="text-orange-600">To: {draft?.opening || "—"}</span>
                            </div>
                          </div>
                        )}
                        {edited.closing && (
                          <div>
                            <p className="text-sm font-semibold text-slate-700">Closing Stock</p>
                            <div className="mt-1 flex gap-2 text-sm">
                              <span className="text-slate-500">From: {formatQuantity(original?.closing)}</span>
                              <span className="text-orange-600">To: {draft?.closing || "—"}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={() => setShowReviewModal(false)}
                  className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleSaveAll()}
                  disabled={saving}
                  className="rounded-2xl bg-orange-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Confirm & Save"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
