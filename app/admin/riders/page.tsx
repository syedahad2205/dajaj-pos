"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { requireAdmin } from "@/lib/roleGuard";
import { getAllOrders, type OrderRecord } from "@/services/orderService";
import { getAllRiders, saveRider, type RiderInput, type RiderProfile } from "@/services/riderService";

const emptyForm: RiderInput = {
  phone: "",
  name: "",
  vehicleType: "Bike",
  accessCode: "",
  isActive: true,
  maxConcurrentOrders: 2,
};

function formatDate(value: unknown) {
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate().toLocaleString();
  }

  return "Not available";
}

export default function AdminRidersPage() {
  const { authenticated, loading, role } = requireAdmin();
  const [riders, setRiders] = useState<RiderProfile[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [form, setForm] = useState<RiderInput>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editingRiderId, setEditingRiderId] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const refreshData = useCallback(async () => {
    if (!authenticated || role !== "admin") {
      setRiders([]);
      setOrders([]);
      setLoadingData(false);
      setLastUpdatedAt(null);
      return;
    }

    setLoadingData(true);
    setError("");
    try {
      const [nextRiders, nextOrders] = await Promise.all([getAllRiders(), getAllOrders()]);
      setRiders(nextRiders);
      setOrders(nextOrders);
      setLastUpdatedAt(Date.now());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load delivery partners.");
    } finally {
      setLoadingData(false);
    }
  }, [authenticated, role]);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  const riderOrderMap = useMemo(() => {
    return riders.reduce<Record<string, { active: OrderRecord[]; completed: OrderRecord[] }>>((accumulator, rider) => {
      const riderOrders = orders.filter((order) => order.assignedRiderId === rider.id);
      accumulator[rider.id] = {
        active: riderOrders.filter((order) => order.orderStatus !== "delivered" && order.orderStatus !== "cancelled"),
        completed: riderOrders.filter((order) => order.orderStatus === "delivered"),
      };
      return accumulator;
    }, {});
  }, [orders, riders]);

  if (loading) {
    return <main className="min-h-screen bg-[#fff8ed] px-4 py-10">Checking your session...</main>;
  }

  if (!authenticated || role !== "admin") {
    return null;
  }

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
          <h1 className="text-3xl font-black">Delivery Partners</h1>
          <p className="mt-2 text-sm text-slate-600">Create rider accounts, review availability, and track who is active on the road right now.</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void refreshData()}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
            >
              Refresh Riders
            </button>
            {lastUpdatedAt ? <p className="text-xs text-slate-400">Last refreshed {new Date(lastUpdatedAt).toLocaleTimeString()}</p> : null}
          </div>
        </header>

        <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-2xl font-black">{editingRiderId ? "Edit Rider" : "Add Rider"}</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm font-semibold text-slate-700">
              <span>Rider Name</span>
              <input
                type="text"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 font-normal"
              />
            </label>

            <label className="space-y-2 text-sm font-semibold text-slate-700">
              <span>Phone Number</span>
              <input
                type="tel"
                value={form.phone}
                onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 font-normal"
              />
            </label>

            <label className="space-y-2 text-sm font-semibold text-slate-700">
              <span>Vehicle Type</span>
              <input
                type="text"
                value={form.vehicleType}
                onChange={(event) => setForm((current) => ({ ...current, vehicleType: event.target.value }))}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 font-normal"
              />
            </label>

            <label className="space-y-2 text-sm font-semibold text-slate-700">
              <span>Access Code</span>
              <input
                type="text"
                value={form.accessCode}
                onChange={(event) => setForm((current) => ({ ...current, accessCode: event.target.value }))}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 font-normal"
              />
            </label>

            <label className="space-y-2 text-sm font-semibold text-slate-700">
              <span>Max Active Orders</span>
              <input
                type="number"
                min="1"
                value={form.maxConcurrentOrders}
                onChange={(event) => setForm((current) => ({ ...current, maxConcurrentOrders: Number(event.target.value) || 1 }))}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 font-normal"
              />
            </label>

            <label className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
              />
              Allow this rider to sign in
            </label>
          </div>

          {error ? <p className="mt-4 text-sm font-medium text-rose-600">{error}</p> : null}

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                setError("");
                try {
                  await saveRider(form);
                  setForm(emptyForm);
                  setEditingRiderId(null);
                  await refreshData();
                } catch (saveError) {
                  setError(saveError instanceof Error ? saveError.message : "Failed to save rider.");
                } finally {
                  setSaving(false);
                }
              }}
              className="rounded-2xl bg-orange-600 px-5 py-4 text-base font-semibold text-white disabled:opacity-50"
            >
              {saving ? "Saving..." : editingRiderId ? "Update Rider" : "Save Rider"}
            </button>

            {editingRiderId ? (
              <button
                type="button"
                onClick={() => {
                  setEditingRiderId(null);
                  setForm(emptyForm);
                  setError("");
                }}
                className="rounded-2xl border border-slate-300 px-5 py-4 text-base font-semibold text-slate-700"
              >
                Cancel
              </button>
            ) : null}
          </div>
        </section>

        <section className="space-y-4">
          {loadingData ? (
            <div className="rounded-[28px] border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
              Loading delivery partners...
            </div>
          ) : riders.length === 0 ? (
            <div className="rounded-[28px] border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
              No delivery partners added yet.
            </div>
          ) : (
            riders.map((rider) => {
              const riderOrders = riderOrderMap[rider.id] || { active: [], completed: [] };

              return (
                <article key={rider.id} className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-orange-600">{rider.vehicleType}</p>
                      <h2 className="text-2xl font-black text-slate-900">{rider.name}</h2>
                      <p className="text-sm text-slate-500">{rider.phone}</p>
                      <div className="flex flex-wrap gap-2 text-xs font-semibold">
                        <span className={`rounded-full px-3 py-1 ${rider.isActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                          {rider.isActive ? "Active" : "Disabled"}
                        </span>
                        <span className={`rounded-full px-3 py-1 ${rider.isAvailable ? "bg-orange-100 text-orange-700" : "bg-slate-100 text-slate-600"}`}>
                          {rider.isAvailable ? "Available for pickup" : "Not available"}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2 lg:text-right">
                      <p className="text-2xl font-black text-slate-900">
                        {rider.currentOrderCount}/{rider.maxConcurrentOrders}
                      </p>
                      <p className="text-sm text-slate-500">Active load</p>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingRiderId(rider.id);
                          setForm({
                            phone: rider.phone,
                            name: rider.name,
                            vehicleType: rider.vehicleType,
                            accessCode: rider.accessCode,
                            isActive: rider.isActive,
                            maxConcurrentOrders: rider.maxConcurrentOrders,
                          });
                        }}
                        className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
                      >
                        Edit Rider
                      </button>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-4 border-t border-slate-200 pt-5 lg:grid-cols-[1fr_1.1fr]">
                    <div className="space-y-3 rounded-2xl border border-slate-200 p-4">
                      <p className="text-sm font-semibold text-slate-500">Live Activity</p>
                      <p className="text-sm text-slate-600">Last seen: {formatDate(rider.lastSeenAt)}</p>
                      {rider.lastLocation ? (
                        <p className="text-sm text-slate-600">
                          Location: {rider.lastLocation.lat.toFixed(5)}, {rider.lastLocation.lng.toFixed(5)}
                        </p>
                      ) : (
                        <p className="text-sm text-slate-600">Location will appear once the rider opens the rider app and shares location.</p>
                      )}
                      <p className="text-sm text-slate-600">Completed deliveries: {riderOrders.completed.length}</p>
                    </div>

                    <div className="space-y-3 rounded-2xl border border-slate-200 p-4">
                      <p className="text-sm font-semibold text-slate-500">Active Orders</p>
                      {riderOrders.active.length === 0 ? (
                        <p className="text-sm text-slate-500">No active orders assigned.</p>
                      ) : (
                        riderOrders.active.map((order) => (
                          <div key={order.id} className="rounded-2xl bg-slate-50 p-3">
                            <p className="font-bold text-slate-900">Order #{order.orderNumber}</p>
                            <p className="text-sm text-slate-500">{order.customerName}</p>
                            <p className="text-xs capitalize text-slate-400">{order.orderStatus.replaceAll("_", " ")}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </section>
      </div>
    </main>
  );
}
