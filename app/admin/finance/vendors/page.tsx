"use client";

import { useEffect, useState } from "react";
import { Archive, ChevronDown, Plus, RotateCcw } from "lucide-react";
import { requireAdmin } from "@/lib/roleGuard";
import { firebaseAuthedFetch } from "@/lib/firebaseAuthFetch";
import { formatCurrency } from "@/lib/financeFormat";
import FinanceNav from "@/components/finance/FinanceNav";
import Modal from "@/components/finance/Modal";

interface VendorRow {
  id: string;
  name: string;
  phone: string;
  gstNumber: string;
  address: string;
  notes: string;
  defaultExpenseCategoryId: string | null;
  defaultExpenseCategoryName: string | null;
  active: boolean;
  totalPurchases: number;
  transactionCount: number;
}

interface ExpenseCategoryOption {
  id: string;
  name: string;
}

async function readJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) throw new Error(payload?.message || "Request failed.");
  return payload;
}

const emptyForm = { name: "", phone: "", gstNumber: "", address: "", notes: "", defaultExpenseCategoryId: "" };

export default function FinanceVendorsPage() {
  const { authenticated, loading, role } = requireAdmin();
  const canQuery = authenticated && role === "admin";

  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [categories, setCategories] = useState<ExpenseCategoryOption[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<VendorRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const load = async () => {
    setFetching(true);
    setError("");
    try {
      const [vendorsRes, categoriesRes] = await Promise.all([
        firebaseAuthedFetch(`/api/finance/vendors?includeInactive=${showInactive}`),
        firebaseAuthedFetch("/api/finance/expense-categories"),
      ]);
      const [vendorsPayload, categoriesPayload] = await Promise.all([readJson(vendorsRes), readJson(categoriesRes)]);
      setVendors(vendorsPayload.vendors);
      setCategories(categoriesPayload.categories);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load vendors.");
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    if (!canQuery) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canQuery, showInactive]);

  if (loading) {
    return <main className="min-h-screen bg-[#fff8ed] px-4 py-10 text-slate-900">Checking your session…</main>;
  }
  if (!authenticated || role !== "admin") return null;

  const openCreateModal = () => {
    setEditing(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEditModal = (vendor: VendorRow) => {
    setEditing(vendor);
    setForm({
      name: vendor.name,
      phone: vendor.phone,
      gstNumber: vendor.gstNumber,
      address: vendor.address,
      notes: vendor.notes,
      defaultExpenseCategoryId: vendor.defaultExpenseCategoryId ?? "",
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setError("Vendor name is required.");
      return;
    }
    setSaving(true);
    setError("");
    const categoryName = categories.find((c) => c.id === form.defaultExpenseCategoryId)?.name ?? null;
    try {
      const body = {
        name: form.name,
        phone: form.phone,
        gstNumber: form.gstNumber,
        address: form.address,
        notes: form.notes,
        defaultExpenseCategoryId: form.defaultExpenseCategoryId || null,
        defaultExpenseCategoryName: form.defaultExpenseCategoryId ? categoryName : null,
      };
      if (editing) {
        await readJson(
          await firebaseAuthedFetch(`/api/finance/vendors/${editing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
        );
      } else {
        await readJson(
          await firebaseAuthedFetch("/api/finance/vendors", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
        );
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save vendor.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (vendor: VendorRow) => {
    setBusyId(vendor.id);
    setError("");
    try {
      await readJson(
        await firebaseAuthedFetch(`/api/finance/vendors/${vendor.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ active: !vendor.active }),
        }),
      );
      setVendors((prev) => prev.map((v) => (v.id === vendor.id ? { ...v, active: !v.active } : v)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update vendor.");
    } finally {
      setBusyId(null);
    }
  };

  const searchLower = search.trim().toLowerCase();
  const visible = vendors.filter((v) => !searchLower || v.name.toLowerCase().includes(searchLower) || v.phone.includes(searchLower));

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-orange-600">Finance</p>
          <h1 className="mt-1 text-3xl font-black">Vendors</h1>
          <p className="mt-2 text-sm text-slate-600">Suppliers DAJAJ pays — chicken, vegetables, packaging, and more.</p>
          <div className="mt-5">
            <FinanceNav />
          </div>
        </header>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search vendors by name or phone…"
            className="flex-1 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowInactive((v) => !v)} className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              {showInactive ? "Hide inactive" : "Show inactive"}
            </button>
            <button type="button" onClick={openCreateModal} className="flex items-center gap-1.5 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
              <Plus className="h-4 w-4" /> Add Vendor
            </button>
          </div>
        </div>

        {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p> : null}

        {fetching ? (
          <p className="text-sm text-slate-500">Loading vendors…</p>
        ) : visible.length === 0 ? (
          <div className="rounded-[28px] border border-slate-200 bg-white p-10 text-center shadow-sm">
            <p className="font-semibold text-slate-400">No vendors found.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {visible.map((vendor) => (
              <article key={vendor.id} className={`rounded-[28px] border bg-white p-6 shadow-sm ${vendor.active ? "border-slate-200" : "border-slate-200 opacity-60"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-black text-slate-900">
                      {vendor.name}
                      {!vendor.active ? <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">Inactive</span> : null}
                    </p>
                    {vendor.phone ? <p className="text-sm text-slate-500">{vendor.phone}</p> : null}
                    {vendor.defaultExpenseCategoryName ? (
                      <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-orange-600">{vendor.defaultExpenseCategoryName}</p>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-black text-slate-900">{formatCurrency(vendor.totalPurchases)}</p>
                    <p className="text-xs text-slate-400">{vendor.transactionCount} purchase(s)</p>
                  </div>
                </div>
                {vendor.address ? <p className="mt-3 text-sm text-slate-500">{vendor.address}</p> : null}
                {vendor.notes ? <p className="mt-1 text-sm italic text-slate-400">{vendor.notes}</p> : null}

                <div className="mt-5 flex flex-wrap gap-2">
                  <button type="button" onClick={() => openEditModal(vendor)} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={busyId === vendor.id}
                    onClick={() => handleToggleActive(vendor)}
                    className="flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {vendor.active ? <Archive className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
                    {vendor.active ? "Deactivate" : "Reactivate"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {modalOpen ? (
        <Modal title={editing ? "Edit Vendor" : "Add Vendor"} onClose={() => setModalOpen(false)} maxWidthClassName="max-w-xl">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-semibold text-slate-700">Vendor Name</label>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">Phone</label>
              <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">GST Number</label>
              <input value={form.gstNumber} onChange={(e) => setForm((f) => ({ ...f, gstNumber: e.target.value }))} className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100" />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-semibold text-slate-700">Default Expense Category</label>
              <div className="relative">
                <select
                  value={form.defaultExpenseCategoryId}
                  onChange={(e) => setForm((f) => ({ ...f, defaultExpenseCategoryId: e.target.value }))}
                  className="appearance-none w-full rounded-2xl border border-slate-300 px-4 py-3 pr-9 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                >
                  <option value="">None</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" strokeWidth={2.5} />
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-semibold text-slate-700">Address</label>
              <textarea value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} rows={2} className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100" />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-semibold text-slate-700">Notes</label>
              <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100" />
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => setModalOpen(false)} className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Cancel
            </button>
            <button type="button" disabled={saving} onClick={handleSave} className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </Modal>
      ) : null}
    </main>
  );
}
