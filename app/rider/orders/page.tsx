"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useRiderOrders } from "@/components/rider/RiderOrdersProvider";
import { requireRider } from "@/lib/roleGuard";
import { formatOrderStatusLabel } from "@/lib/orderStatus";
import type { DeliveryAssignmentRecord } from "@/services/deliveryAssignmentService";

export default function RiderOrdersPage() {
  const { authenticated, loading, role, rider } = requireRider();
  const { orders, error, lastUpdatedAt, refreshOrders } = useRiderOrders();

  const activeOrders = useMemo(
    () => orders.filter((order) => order.orderStatus !== "delivered" && order.orderStatus !== "cancelled"),
    [orders],
  );
  const completedOrders = useMemo(
    () => orders.filter((order) => order.orderStatus === "delivered" || order.orderStatus === "cancelled"),
    [orders],
  );

  if (loading) {
    return <main className="min-h-screen bg-[#eefcf4] px-4 py-10">Checking your session...</main>;
  }

  if (!authenticated || role !== "rider" || !rider) {
    return null;
  }

  const renderOrders = (title: string, list: DeliveryAssignmentRecord[]) => (
    <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-2xl font-black">{title}</h2>
      <div className="mt-4 space-y-3">
        {list.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">No orders in this section.</p>
        ) : (
          list.map((order) => (
            <Link key={order.id} href={`/rider/order/${order.id}`} className="block rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-600">Order #{order.orderNumber}</p>
                  <h3 className="mt-2 text-lg font-black text-slate-900">{order.customerName}</h3>
                  <p className="text-sm text-slate-500">{order.customerPhone}</p>
                  <p className="mt-1 text-sm text-slate-500">{order.address.addressLine1}</p>
                </div>

                <div className="space-y-2 text-right">
                  <p className="text-xl font-black text-slate-900">₹{order.total}</p>
                  <p className="text-sm font-semibold capitalize text-slate-600">{formatOrderStatusLabel(order.orderStatus)}</p>
                  <p className="text-xs text-slate-400">{order.items.length} {order.items.length === 1 ? "item" : "items"}</p>
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </section>
  );

  return (
    <main className="min-h-screen bg-[#eefcf4] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-5xl space-y-4">
        <header className="rounded-[28px] border border-emerald-200 bg-white p-6 shadow-sm">
          <Link href="/rider" className="mb-4 inline-flex rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">
            Back to Rider Home
          </Link>
          <h1 className="text-3xl font-black">Your Delivery Orders</h1>
          <p className="mt-2 text-sm text-slate-600">Manage pickups, active drops, and completed deliveries from one list.</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                void refreshOrders();
              }}
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700"
            >
              Refresh Orders
            </button>
            {lastUpdatedAt ? <p className="text-xs text-slate-500">Last refreshed: {new Date(lastUpdatedAt).toLocaleTimeString()}</p> : null}
          </div>
          {error ? <p className="mt-4 text-sm font-medium text-rose-600">{error}</p> : null}
        </header>

        {renderOrders("Active Deliveries", activeOrders)}
        {renderOrders("Completed Deliveries", completedOrders)}
      </div>
    </main>
  );
}
