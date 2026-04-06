"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRiderOrders } from "@/components/rider/RiderOrdersProvider";
import { requireRider } from "@/lib/roleGuard";
import { formatOrderStatusLabel } from "@/lib/orderStatus";
import { getAssignmentById, markOrderDelivered, markOrderPickedUp, toDeliveryAssignmentRecord, type DeliveryAssignmentRecord } from "@/services/deliveryAssignmentService";
import { getOrderById } from "@/services/orderService";
import { getOrderTracking, updateRiderLocationForActiveOrders, type OrderTrackingRecord } from "@/services/trackingService";

export default function RiderOrderDetailPage({
  params,
}: {
  params: { orderId: string };
}) {
  const { authenticated, loading, role, rider } = requireRider();
  const { orders, refreshOrders, lastUpdatedAt } = useRiderOrders();
  const [order, setOrder] = useState<DeliveryAssignmentRecord | null>(null);
  const [tracking, setTracking] = useState<OrderTrackingRecord | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingPage, setLoadingPage] = useState(true);
  const [savingLocation, setSavingLocation] = useState(false);
  const [status, setStatus] = useState("Loading order...");

  const fallbackOrder = useMemo(
    () => orders.find((entry) => entry.id === params.orderId || entry.orderId === params.orderId) ?? null,
    [orders, params.orderId],
  );

  useEffect(() => {
    if (!authenticated || !rider) {
      return;
    }

    void (async () => {
      setLoadingPage(true);

      try {
        const [assignment, directOrder] = await Promise.all([
          getAssignmentById(params.orderId),
          getOrderById(params.orderId),
        ]);

        if (assignment && assignment.assignedRiderId === rider.id) {
          setOrder(assignment);
          setStatus("");
        } else if (directOrder && directOrder.assignedRiderId === rider.id) {
          setOrder(toDeliveryAssignmentRecord(directOrder));
          setStatus("");
        } else if (fallbackOrder) {
          setOrder(fallbackOrder);
          setStatus("");
        } else {
          setOrder(null);
          setStatus("Order not found.");
        }

        setTracking(await getOrderTracking(params.orderId));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load order.");
      } finally {
        setLoadingPage(false);
      }
    })();
  }, [authenticated, fallbackOrder, params.orderId, rider]);

  useEffect(() => {
    if (fallbackOrder && !order) {
      setOrder(fallbackOrder);
      setStatus("");
    }
  }, [fallbackOrder, order]);

  if (loading || loadingPage) {
    return <main className="min-h-screen bg-[#eefcf4] px-4 py-10">Checking your session...</main>;
  }

  if (!authenticated || role !== "rider" || !rider) {
    return null;
  }

  return (
    <main className="min-h-screen bg-[#eefcf4] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-4xl space-y-4">
        <header className="rounded-[28px] border border-emerald-200 bg-white p-6 shadow-sm">
          <Link href="/rider/orders" className="mb-4 inline-flex rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">
            Back to Orders
          </Link>
          <h1 className="text-3xl font-black">Delivery Order</h1>
          {order ? <p className="mt-2 text-sm text-slate-600">Order #{order.orderNumber}</p> : null}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={saving || savingLocation}
              onClick={async () => {
                setError("");
                await refreshOrders();
                setLoadingPage(true);
                try {
                  const [assignment, directOrder, nextTracking] = await Promise.all([
                    getAssignmentById(params.orderId),
                    getOrderById(params.orderId),
                    getOrderTracking(params.orderId),
                  ]);

                  if (assignment && rider && assignment.assignedRiderId === rider.id) {
                    setOrder(assignment);
                    setStatus("");
                  } else if (directOrder && rider && directOrder.assignedRiderId === rider.id) {
                    setOrder(toDeliveryAssignmentRecord(directOrder));
                    setStatus("");
                  } else {
                    setOrder(null);
                    setStatus("Order not found.");
                  }

                  setTracking(nextTracking);
                } catch (refreshError) {
                  setError(refreshError instanceof Error ? refreshError.message : "Failed to refresh order.");
                } finally {
                  setLoadingPage(false);
                }
              }}
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700"
            >
              Refresh Order
            </button>

            {lastUpdatedAt ? <p className="text-xs text-slate-500">Orders refreshed: {new Date(lastUpdatedAt).toLocaleTimeString()}</p> : null}
          </div>
        </header>

        {!order ? (
          <section className="rounded-[28px] border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
            {status}
          </section>
        ) : (
          <>
            <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-600">Customer</p>
                  <h2 className="mt-2 text-2xl font-black text-slate-900">{order.customerName}</h2>
                  <p className="text-sm text-slate-500">{order.customerPhone}</p>
                </div>
                <div className="text-right">
                  <p className="text-3xl font-black text-slate-900">₹{order.total}</p>
                  <p className="text-sm font-semibold capitalize text-slate-600">{formatOrderStatusLabel(order.orderStatus)}</p>
                </div>
              </div>
            </section>

            <section className="grid gap-4 md:grid-cols-2">
              <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-xl font-black">Delivery Address</h2>
                <div className="mt-4 space-y-2 text-sm text-slate-600">
                  <p className="font-semibold text-slate-900">{order.address.label}</p>
                  <p>{order.address.addressLine1}</p>
                  {order.address.addressLine2 ? <p>{order.address.addressLine2}</p> : null}
                  {order.address.landmark ? <p>Near {order.address.landmark}</p> : null}
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${order.location.lat},${order.location.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex rounded-xl border border-slate-300 px-3 py-2 font-semibold text-slate-700"
                  >
                    Open in Maps
                  </a>
                </div>
              </div>

              <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-xl font-black">Delivery Progress</h2>
                <div className="mt-4 space-y-2 text-sm text-slate-600">
                  <p>Status: <span className="font-semibold capitalize text-slate-900">{formatOrderStatusLabel(order.deliveryStatus)}</span></p>
                  {tracking ? (
                    <>
                      <p>Distance to customer: {tracking.distanceKmToCustomer.toFixed(2)} km</p>
                      <p>Estimated arrival: {tracking.etaMinutes} mins</p>
                    </>
                  ) : (
                    <p>Update your location manually to refresh customer ETA.</p>
                  )}
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
                              [order],
                            );
                            setTracking(await getOrderTracking(order.id));
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
                    className="mt-3 rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50"
                  >
                    {savingLocation ? "Updating Location..." : "Update My Location"}
                  </button>
                </div>
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
                        {item.modifiers.length > 0 ? <p className="mt-2 text-xs text-slate-400">{item.modifiers.map((modifier) => modifier.name).join(" • ")}</p> : null}
                      </div>
                      <span className="font-black text-slate-900">₹{item.totalPrice}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p> : null}

            <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap gap-3">
                {order.orderStatus === "ready" ? (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={async () => {
                      setSaving(true);
                      setError("");
                      try {
                        await markOrderPickedUp(order, rider.id);
                        await refreshOrders();
                        setTracking(await getOrderTracking(order.id));
                        const refreshedOrder = await getAssignmentById(order.id);
                        if (refreshedOrder) {
                          setOrder(refreshedOrder);
                        }
                      } catch (pickupError) {
                        setError(pickupError instanceof Error ? pickupError.message : "Failed to mark pickup.");
                      } finally {
                        setSaving(false);
                      }
                    }}
                    className="rounded-2xl bg-emerald-500 px-5 py-4 text-base font-semibold text-slate-950 disabled:opacity-50"
                  >
                    Mark Picked Up
                  </button>
                ) : null}

                {order.orderStatus === "out_for_delivery" ? (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={async () => {
                      setSaving(true);
                      setError("");
                      try {
                        await markOrderDelivered(order, rider);
                        await refreshOrders();
                        setTracking(await getOrderTracking(order.id));
                        const refreshedOrder = await getAssignmentById(order.id);
                        if (refreshedOrder) {
                          setOrder(refreshedOrder);
                        }
                      } catch (deliveryError) {
                        setError(deliveryError instanceof Error ? deliveryError.message : "Failed to mark delivered.");
                      } finally {
                        setSaving(false);
                      }
                    }}
                    className="rounded-2xl bg-slate-900 px-5 py-4 text-base font-semibold text-white disabled:opacity-50"
                  >
                    Mark Delivered
                  </button>
                ) : null}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
