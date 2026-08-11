"use client";

import { useEffect, useState } from "react";
import { requireAdmin } from "@/lib/roleGuard";
import NativeSelectField from "@/components/ui/NativeSelectField";
import { formatOrderStatusLabel } from "@/lib/orderStatus";
import { assignOrderToRider, autoAssignOrder, cancelOrder, unassignOrder } from "@/services/deliveryAssignmentService";
import { subscribeToAllOrders, updateOrderStatus, type OrderRecord, type OrderStatus } from "@/services/orderService";
import { subscribeToRiders, type RiderProfile } from "@/services/riderService";
import { subscribeToOrderTracking, type OrderTrackingRecord } from "@/services/trackingService";

const statusFlow: Record<OrderStatus, { label: string; next: OrderStatus } | null> = {
  pending: { label: "Accept", next: "accepted" },
  accepted: { label: "Start Preparing", next: "preparing" },
  preparing: { label: "Mark Ready", next: "ready" },
  ready: null,
  out_for_delivery: null,
  delivered: null,
  cancelled: null,
};

function formatDate(value: unknown) {
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate().toLocaleString();
  }

  return "Just now";
}

export default function AdminOrdersPage() {
  const { authenticated, loading, role } = requireAdmin();
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [riders, setRiders] = useState<RiderProfile[]>([]);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [savingOrderId, setSavingOrderId] = useState<string | null>(null);
  const [selectedRiderByOrder, setSelectedRiderByOrder] = useState<Record<string, string>>({});
  const [tracking, setTracking] = useState<OrderTrackingRecord | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!authenticated || role !== "admin") {
      return;
    }

    const unsubscribeOrders = subscribeToAllOrders(setOrders);
    const unsubscribeRiders = subscribeToRiders(setRiders);

    return () => {
      unsubscribeOrders();
      unsubscribeRiders();
    };
  }, [authenticated, role]);

  useEffect(() => {
    if (!expandedOrderId) {
      setTracking(null);
      return;
    }

    return subscribeToOrderTracking(expandedOrderId, setTracking);
  }, [expandedOrderId]);

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
          <h1 className="text-3xl font-black">All Orders</h1>
          <p className="mt-2 text-sm text-slate-600">Track incoming orders and move them through the kitchen workflow.</p>
        </header>

        {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p> : null}

        {orders.map((order) => {
          const expanded = expandedOrderId === order.id;
          const nextAction = statusFlow[order.orderStatus];
          const selectedRiderId = selectedRiderByOrder[order.id] ?? order.assignedRiderId;
          const assignedRider = riders.find((rider) => rider.id === order.assignedRiderId) ?? null;
          const availableRiders = riders.filter(
            (rider) =>
              rider.isActive &&
              (rider.id === order.assignedRiderId || (rider.isAvailable && rider.currentOrderCount < rider.maxConcurrentOrders)),
          );

          return (
            <section key={order.id} className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-orange-600">Order #{order.orderNumber}</p>
                  <h2 className="text-xl font-black text-slate-900">{order.customerName}</h2>
                  <p className="text-sm text-slate-500">{order.customerPhone}</p>
                  <p className="text-sm text-slate-500">{formatDate(order.createdAt)}</p>
                </div>

                <div className="space-y-2 lg:text-right">
                  <p className="text-2xl font-black text-slate-900">₹{order.total}</p>
                  <p className="text-sm font-semibold capitalize text-slate-600">{formatOrderStatusLabel(order.orderStatus)}</p>
                  {order.assignedRiderName ? <p className="text-xs text-slate-400">Rider: {order.assignedRiderName}</p> : null}
                  <button
                    type="button"
                    onClick={() => setExpandedOrderId((current) => (current === order.id ? null : order.id))}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
                  >
                    {expanded ? "Hide Details" : "View Details"}
                  </button>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {nextAction ? (
                  <button
                    type="button"
                    disabled={savingOrderId === order.id}
                    onClick={async () => {
                      setSavingOrderId(order.id);
                      setError("");
                      try {
                        await updateOrderStatus(order.id, nextAction.next);
                      } catch (statusError) {
                        setError(statusError instanceof Error ? statusError.message : "Failed to update order status.");
                      } finally {
                        setSavingOrderId(null);
                      }
                    }}
                    className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {nextAction.label}
                  </button>
                ) : null}

                {order.orderStatus !== "cancelled" && order.orderStatus !== "delivered" ? (
                  <button
                    type="button"
                    disabled={savingOrderId === order.id}
                    onClick={async () => {
                      setSavingOrderId(order.id);
                      setError("");
                      try {
                        await cancelOrder(order, assignedRider);
                      } catch (statusError) {
                        setError(statusError instanceof Error ? statusError.message : "Failed to cancel order.");
                      } finally {
                        setSavingOrderId(null);
                      }
                    }}
                    className="rounded-xl border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50"
                  >
                    Cancel Order
                  </button>
                ) : null}
              </div>

              {expanded ? (
                <div className="mt-5 grid gap-4 border-t border-slate-200 pt-5 lg:grid-cols-[1.4fr_0.9fr]">
                  <div className="space-y-3">
                    {order.items.map((item) => (
                      <div key={item.id} className="rounded-2xl bg-slate-50 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-bold text-slate-900">{item.categoryName}</p>
                            <p className="text-sm text-slate-500">{item.variantName} × {item.quantity}</p>
                            {item.modifiers.length > 0 ? (
                              <div className="mt-2 space-y-1 text-xs text-slate-400">
                                {item.modifiers.map((modifier) => (
                                  <p key={`${item.id}-${modifier.id}`}>{modifier.groupName}: {modifier.name}</p>
                                ))}
                              </div>
                            ) : null}
                          </div>
                          <span className="font-black text-slate-900">₹{item.totalPrice}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-200 p-4">
                      <p className="text-sm font-semibold text-slate-500">Delivery Dispatch</p>

                      {order.assignedRiderName ? (
                        <div className="mt-3 space-y-1 text-sm text-slate-600">
                          <p className="font-bold text-slate-900">{order.assignedRiderName}</p>
                          <p>{order.assignedRiderPhone}</p>
                          <p className="capitalize">Delivery status: {formatOrderStatusLabel(order.deliveryStatus)}</p>
                          {tracking && order.deliveryStatus === "on_the_way" ? (
                            <>
                              <p>Distance to customer: {tracking.distanceKmToCustomer.toFixed(2)} km</p>
                              <p>Estimated arrival: {tracking.etaMinutes} mins</p>
                              <p className="text-xs text-slate-400">
                                Rider location: {tracking.riderLocation.lat.toFixed(5)}, {tracking.riderLocation.lng.toFixed(5)}
                              </p>
                            </>
                          ) : null}
                        </div>
                      ) : (
                        <p className="mt-3 text-sm text-slate-600">No rider assigned yet.</p>
                      )}

                      {order.orderStatus === "ready" && order.deliveryStatus !== "on_the_way" ? (
                        <div className="mt-4 space-y-3">
                          <NativeSelectField
                            value={selectedRiderId}
                            onChange={(event) =>
                              setSelectedRiderByOrder((current) => ({
                                ...current,
                                [order.id]: event.target.value,
                              }))
                            }
                            displayValue={(() => {
                              const rider = availableRiders.find((r) => r.id === selectedRiderId);
                              return rider ? `${rider.name} • ${rider.currentOrderCount}/${rider.maxConcurrentOrders} active` : "Select a rider";
                            })()}
                            placeholder={!selectedRiderId}
                          >
                            <option value="">Select a rider</option>
                            {availableRiders.map((rider) => (
                              <option key={rider.id} value={rider.id}>
                                {rider.name} • {rider.currentOrderCount}/{rider.maxConcurrentOrders} active
                              </option>
                            ))}
                          </NativeSelectField>

                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={savingOrderId === order.id}
                              onClick={async () => {
                                const nextRider = riders.find((rider) => rider.id === selectedRiderId);
                                if (!nextRider) {
                                  setError("Choose a rider before assigning.");
                                  return;
                                }

                                setSavingOrderId(order.id);
                                setError("");
                                try {
                                  await assignOrderToRider(order, nextRider, assignedRider);
                                } catch (assignError) {
                                  setError(assignError instanceof Error ? assignError.message : "Failed to assign rider.");
                                } finally {
                                  setSavingOrderId(null);
                                }
                              }}
                              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                            >
                              Assign Rider
                            </button>

                            <button
                              type="button"
                              disabled={savingOrderId === order.id}
                              onClick={async () => {
                                setSavingOrderId(order.id);
                                setError("");
                                try {
                                  await autoAssignOrder(order, riders);
                                } catch (assignError) {
                                  setError(assignError instanceof Error ? assignError.message : "Failed to auto assign rider.");
                                } finally {
                                  setSavingOrderId(null);
                                }
                              }}
                              className="rounded-xl border border-orange-300 px-4 py-2 text-sm font-semibold text-orange-700 disabled:opacity-50"
                            >
                              Auto Assign Best Rider
                            </button>

                            {order.assignedRiderId ? (
                              <button
                                type="button"
                                disabled={savingOrderId === order.id}
                                onClick={async () => {
                                  setSavingOrderId(order.id);
                                  setError("");
                                  try {
                                    await unassignOrder(order, assignedRider);
                                  } catch (assignError) {
                                    setError(assignError instanceof Error ? assignError.message : "Failed to unassign rider.");
                                  } finally {
                                    setSavingOrderId(null);
                                  }
                                }}
                                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
                              >
                                Unassign Rider
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="rounded-2xl border border-slate-200 p-4">
                      <p className="text-sm font-semibold text-slate-500">Delivery Address</p>
                      <p className="mt-2 font-bold text-slate-900">{order.address.label}</p>
                      <p className="text-sm text-slate-600">{order.address.addressLine1}</p>
                      {order.address.addressLine2 ? <p className="text-sm text-slate-600">{order.address.addressLine2}</p> : null}
                      {order.address.landmark ? <p className="text-sm text-slate-600">Near {order.address.landmark}</p> : null}
                      <p className="mt-2 text-sm text-slate-600">{order.customerPhone}</p>
                    </div>

                    <div className="rounded-2xl border border-slate-200 p-4">
                      <p className="text-sm font-semibold text-slate-500">Payment</p>
                      <p className="mt-2 text-sm text-slate-600">Method: {order.paymentMethod}</p>
                      <p className="text-sm text-slate-600 capitalize">Payment status: {order.paymentStatus}</p>
                      <p className="mt-3 text-sm text-slate-600">Subtotal: ₹{order.subtotal}</p>
                      <p className="text-sm text-slate-600">Delivery fee: ₹{order.deliveryFee}</p>
                      <p className="text-lg font-black text-slate-900">Total: ₹{order.total}</p>
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </main>
  );
}
