"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { requireCustomer } from "@/lib/roleGuard";
import { formatOrderStatusLabel, getDeliveryStatusCopy } from "@/lib/orderStatus";
import { subscribeToOrder, type OrderRecord } from "@/services/orderService";
import { subscribeToOrderTracking, type OrderTrackingRecord } from "@/services/trackingService";

function formatDate(value: unknown) {
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate().toLocaleString();
  }

  return "Just now";
}

export default function OrderDetailPage({
  params,
}: {
  params: { orderId: string };
}) {
  const { authenticated, loading, role, customerPhone } = requireCustomer();
  const [order, setOrder] = useState<OrderRecord | null>(null);
  const [tracking, setTracking] = useState<OrderTrackingRecord | null>(null);
  const [status, setStatus] = useState("Loading order...");

  useEffect(() => {
    if (!authenticated || role !== "customer" || !customerPhone) {
      return;
    }

    return subscribeToOrder(params.orderId, (nextOrder) => {
      if (!nextOrder || nextOrder.userId !== customerPhone) {
        setOrder(null);
        setStatus("Order not found.");
        return;
      }

      setOrder(nextOrder);
      setStatus("");
    });
  }, [authenticated, customerPhone, params.orderId, role]);

  useEffect(() => {
    if (!order) {
      setTracking(null);
      return;
    }

    return subscribeToOrderTracking(order.id, setTracking);
  }, [order]);

  if (loading) {
    return <main className="min-h-screen bg-[#fff8ed] px-4 py-10">Checking your session...</main>;
  }

  if (!authenticated || role !== "customer") {
    return null;
  }

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-4xl space-y-4">
        <header className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
          <Link href="/orders" className="mb-4 inline-flex rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">
            Back to Orders
          </Link>
          <h1 className="text-3xl font-black">Order Details</h1>
          {order ? <p className="mt-2 text-sm text-slate-600">Order #{order.orderNumber} • {formatDate(order.createdAt)}</p> : null}
        </header>

        {!order ? (
          <section className="rounded-[28px] border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
            {status}
          </section>
        ) : (
          <>
            <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-orange-600">Order #{order.orderNumber}</p>
                  <p className="mt-2 text-xl font-black text-slate-900">₹{order.total}</p>
                  <p className="mt-2 text-sm text-slate-600">
                    {getDeliveryStatusCopy({
                      orderStatus: order.orderStatus,
                      deliveryStatus: order.deliveryStatus,
                      riderName: order.assignedRiderName,
                    })}
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold capitalize text-slate-700">
                  {formatOrderStatusLabel(order.orderStatus)}
                </span>
              </div>
            </section>

            <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-black">Delivery Updates</h2>
              <div className="mt-4 space-y-2 text-sm text-slate-600">
                <p className="capitalize">
                  Delivery status: <span className="font-semibold text-slate-900">{formatOrderStatusLabel(order.deliveryStatus)}</span>
                </p>
                {order.assignedRiderName ? <p>Delivery partner: {order.assignedRiderName}</p> : <p>Waiting for rider assignment.</p>}
                {tracking && order.deliveryStatus === "on_the_way" ? (
                  <>
                    <p>Distance to you: {tracking.distanceKmToCustomer.toFixed(2)} km</p>
                    <p>Estimated arrival: {tracking.etaMinutes} mins</p>
                  </>
                ) : null}
              </div>
            </section>

            <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-black">Items</h2>
              <div className="mt-4 space-y-3">
                {order.items.map((item) => (
                  <div key={item.id} className="rounded-2xl bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-bold text-slate-900">{item.categoryName}</p>
                        <p className="text-sm text-slate-500">{item.variantName} × {item.quantity}</p>
                        {item.modifiers.length > 0 ? (
                          <p className="mt-2 text-xs text-slate-400">
                            {item.modifiers.map((modifier) => `${modifier.groupName}: ${modifier.name}`).join(" • ")}
                          </p>
                        ) : null}
                      </div>
                      <span className="font-black text-slate-900">₹{item.totalPrice}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="grid gap-4 md:grid-cols-2">
              <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-xl font-black">Delivery Address</h2>
                <div className="mt-4 space-y-1 text-sm text-slate-600">
                  <p className="font-semibold text-slate-900">{order.address.label}</p>
                  <p>{order.address.addressLine1}</p>
                  {order.address.addressLine2 ? <p>{order.address.addressLine2}</p> : null}
                  {order.address.landmark ? <p>Near {order.address.landmark}</p> : null}
                  <p>{order.customerPhone}</p>
                </div>
              </div>

              <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-xl font-black">Payment</h2>
                <div className="mt-4 space-y-2 text-sm text-slate-600">
                  <p>Method: {order.paymentMethod}</p>
                  <p className="capitalize">Status: {order.paymentStatus}</p>
                  <p>Subtotal: ₹{order.subtotal}</p>
                  <p>Delivery fee: ₹{order.deliveryFee}</p>
                  <p className="text-lg font-black text-slate-900">Total: ₹{order.total}</p>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
