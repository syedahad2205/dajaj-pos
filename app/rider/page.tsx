"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useRiderAuth } from "@/components/auth/RiderAuthProvider";
import { useRiderOrders } from "@/components/rider/RiderOrdersProvider";
import { requireRider } from "@/lib/roleGuard";
import { formatOrderStatusLabel } from "@/lib/orderStatus";
import { updateRiderAvailability } from "@/services/riderService";
import { updateRiderLocationForActiveOrders } from "@/services/trackingService";

function formatDate(value: unknown) {
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate().toLocaleString();
  }

  return "Just now";
}

export default function RiderDashboardPage() {
  const router = useRouter();
  const { authenticated, loading, role, rider } = requireRider();
  const { clearRiderSession } = useRiderAuth();
  const { orders, error: ordersError, lastUpdatedAt, refreshOrders } = useRiderOrders();
  const [savingAvailability, setSavingAvailability] = useState(false);
  const [savingLocation, setSavingLocation] = useState(false);
  const [error, setError] = useState("");

  const activeOrders = useMemo(
    () => orders.filter((order) => order.orderStatus !== "delivered" && order.orderStatus !== "cancelled"),
    [orders],
  );
  const deliveredToday = useMemo(
    () => orders.filter((order) => order.orderStatus === "delivered").length,
    [orders],
  );

  if (loading) {
    return <main className="min-h-screen bg-[#eefcf4] px-4 py-10">Checking your session...</main>;
  }

  if (!authenticated || role !== "rider" || !rider) {
    return null;
  }

  return (
    <main className="min-h-screen bg-[#eefcf4] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-5xl space-y-4">
        <header className="rounded-[28px] border border-emerald-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-600">Delivery Partner</p>
              <h1 className="mt-2 text-3xl font-black">{rider.name}</h1>
              <p className="mt-2 text-sm text-slate-600">{rider.vehicleType} • {rider.phone}</p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={loading}
                onClick={() => {
                  void refreshOrders();
                }}
                className="rounded-2xl border border-slate-300 bg-white px-5 py-4 text-base font-semibold text-slate-700"
              >
                Refresh Orders
              </button>

              <button
                type="button"
                disabled={savingAvailability}
                onClick={async () => {
                  setSavingAvailability(true);
                  setError("");
                  try {
                    await updateRiderAvailability(rider.id, !rider.isAvailable);
                  } catch (availabilityError) {
                    setError(availabilityError instanceof Error ? availabilityError.message : "Failed to update availability.");
                  } finally {
                    setSavingAvailability(false);
                  }
                }}
                className={`rounded-2xl px-5 py-4 text-base font-semibold ${
                  rider.isAvailable ? "bg-emerald-500 text-slate-950" : "border border-slate-300 bg-white text-slate-700"
                }`}
              >
                {rider.isAvailable ? "Available for Pickup" : "Mark Available"}
              </button>

              <button
                type="button"
                disabled={savingLocation}
                onClick={() => {
                  if (typeof navigator === "undefined") {
                    setError("Location is not available on this device.");
                    return;
                  }

                  setSavingLocation(true);
                  setError("");
                  navigator.geolocation.getCurrentPosition(
                    async (position) => {
                      try {
                        await updateRiderLocationForActiveOrders(
                          {
                            id: rider.id,
                            name: rider.name,
                          },
                          {
                            lat: position.coords.latitude,
                            lng: position.coords.longitude,
                          },
                          orders,
                        );
                      } catch (locationError) {
                        setError(locationError instanceof Error ? locationError.message : "Failed to update location.");
                      } finally {
                        setSavingLocation(false);
                      }
                    },
                    () => {
                      setError("Unable to read your current location.");
                      setSavingLocation(false);
                    },
                    {
                      enableHighAccuracy: true,
                      timeout: 10000,
                    },
                  );
                }}
                className="rounded-2xl border border-slate-300 bg-white px-5 py-4 text-base font-semibold text-slate-700 disabled:opacity-50"
              >
                {savingLocation ? "Updating Location..." : "Update My Location"}
              </button>

              <button
                type="button"
                onClick={() => {
                  clearRiderSession();
                  router.push("/rider/login");
                }}
                className="rounded-2xl border border-slate-300 bg-white px-5 py-4 text-base font-semibold text-slate-700"
              >
                Sign Out
              </button>
            </div>
          </div>
          {error ? <p className="mt-4 text-sm font-medium text-rose-600">{error}</p> : null}
          {ordersError ? <p className="mt-4 text-sm font-medium text-rose-600">{ordersError}</p> : null}
          {lastUpdatedAt ? <p className="mt-2 text-xs text-slate-500">Last refreshed: {new Date(lastUpdatedAt).toLocaleTimeString()}</p> : null}
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-semibold text-slate-500">Active Orders</p>
            <p className="mt-3 text-4xl font-black text-slate-900">{activeOrders.length}</p>
          </div>
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-semibold text-slate-500">Current Load</p>
            <p className="mt-3 text-4xl font-black text-slate-900">
              {rider.currentOrderCount}/{rider.maxConcurrentOrders}
            </p>
          </div>
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-semibold text-slate-500">Completed Orders</p>
            <p className="mt-3 text-4xl font-black text-slate-900">{deliveredToday}</p>
          </div>
        </section>

        <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-black">Assigned Orders</h2>
              <p className="mt-1 text-sm text-slate-500">Open your delivery list and update order milestones from pickup to drop-off.</p>
            </div>
            <Link href="/rider/orders" className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white">
              Open Orders
            </Link>
          </div>

          <div className="mt-4 space-y-3">
            {activeOrders.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">No active deliveries assigned right now.</p>
            ) : (
              activeOrders.slice(0, 3).map((order) => (
                <Link
                  key={order.id}
                  href={`/rider/order/${order.id}`}
                  className="block rounded-2xl border border-slate-200 bg-slate-50 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-600">Order #{order.orderNumber}</p>
                      <p className="mt-2 text-lg font-black text-slate-900">{order.customerName}</p>
                      <p className="text-sm text-slate-500">{order.address.addressLine1}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold capitalize text-slate-600">{formatOrderStatusLabel(order.orderStatus)}</p>
                      <p className="mt-1 text-xs text-slate-400">{formatDate(order.createdAt)}</p>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
