"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, ChevronUp, ArrowRight } from "lucide-react";
import { requireCustomer } from "@/lib/roleGuard";
import { getDeliveryStatusCopy, formatOrderStatusLabel } from "@/lib/orderStatus";
import { subscribeToUserOrders, type OrderRecord, type OrderStatus } from "@/services/orderService";
import CustomerNavBar from "@/components/CustomerNavBar";

// ── Helpers ────────────────────────────────────────────────────────────

function getOrderDate(order: OrderRecord): Date {
  const ca = order.createdAt;
  if (ca && typeof ca === "object" && "toDate" in ca && typeof (ca as { toDate: () => Date }).toDate === "function") {
    return (ca as { toDate: () => Date }).toDate();
  }
  return new Date(0);
}

function timeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: days > 365 ? "numeric" : undefined });
}

function itemsSummary(order: OrderRecord): string {
  if (order.items.length === 0) return "No items";
  const first = order.items
    .slice(0, 2)
    .map((i) => `${i.variantName} ×${i.quantity}`)
    .join(", ");
  const extra = order.items.length > 2 ? ` +${order.items.length - 2} more` : "";
  return first + extra;
}

// ── Status config ──────────────────────────────────────────────────────

const STATUS_CHIPS: Record<OrderStatus, { label: string; className: string }> = {
  pending: { label: "Waiting", className: "bg-amber-50 text-amber-700 border-amber-200" },
  accepted: { label: "Accepted", className: "bg-blue-50 text-blue-700 border-blue-200" },
  preparing: { label: "Preparing", className: "bg-orange-50 text-orange-700 border-orange-200" },
  ready: { label: "Ready", className: "bg-violet-50 text-violet-700 border-violet-200" },
  out_for_delivery: { label: "On the way", className: "bg-sky-50 text-sky-700 border-sky-200" },
  delivered: { label: "Delivered", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  cancelled: { label: "Cancelled", className: "bg-rose-50 text-rose-700 border-rose-200" },
};

const ACTIVE_STATUSES: OrderStatus[] = ["pending", "accepted", "preparing", "ready", "out_for_delivery"];

const TIMELINE_STEPS: { key: string; label: string }[] = [
  { key: "placed", label: "Placed" },
  { key: "accepted", label: "Accepted" },
  { key: "preparing", label: "Preparing" },
  { key: "out_for_delivery", label: "On the way" },
  { key: "delivered", label: "Delivered" },
];

function getTimelineStep(status: OrderStatus): number {
  switch (status) {
    case "pending": return 0;
    case "accepted": return 1;
    case "preparing": return 2;
    case "ready": return 2;
    case "out_for_delivery": return 3;
    case "delivered": return 4;
    case "cancelled": return -1;
    default: return 0;
  }
}

// ── Sub-components ─────────────────────────────────────────────────────

function StatusChip({ status }: { status: OrderStatus }) {
  const cfg = STATUS_CHIPS[status] ?? { label: formatOrderStatusLabel(status), className: "bg-slate-100 text-slate-700 border-slate-200" };
  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

function OrderTimeline({ status }: { status: OrderStatus }): JSX.Element | null {
  if (status === "cancelled") return null;
  const current = getTimelineStep(status);

  return (
    <div className="flex items-start">
      {TIMELINE_STEPS.map((step, idx) => {
        const done = idx <= current;
        const active = idx === current;

        return (
          <div key={step.key} className="flex flex-1 flex-col items-center last:flex-none last:max-w-[28px]">
            <div className="flex w-full items-center">
              <div
                className={`relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                  done
                    ? "border-orange-500 bg-orange-500"
                    : "border-slate-200 bg-white"
                } ${active ? "ring-2 ring-orange-200 ring-offset-1" : ""}`}
              >
                {done ? (
                  <svg viewBox="0 0 12 12" className="h-3 w-3 text-white" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="2,6 5,9 10,3" />
                  </svg>
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-200" />
                )}
              </div>
              {idx < TIMELINE_STEPS.length - 1 && (
                <div
                  className={`h-0.5 flex-1 transition-colors ${
                    idx < current ? "bg-orange-500" : "bg-slate-200"
                  }`}
                />
              )}
            </div>
            <p
              className={`mt-1 hidden text-center text-[9px] font-semibold leading-snug sm:block ${
                done ? "text-orange-600" : "text-slate-300"
              }`}
            >
              {step.label}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function OrderCard({ order }: { order: OrderRecord }) {
  const [expanded, setExpanded] = useState(false);
  const orderDate = getOrderDate(order);
  const isActive: boolean = ACTIVE_STATUSES.some((s) => s === order.orderStatus);
  const previewItems = order.items.slice(0, 3);
  const extraCount = order.items.length - previewItems.length;

  return (
    <article
      className={`overflow-hidden rounded-[28px] border bg-white shadow-sm transition-shadow hover:shadow-md ${
        isActive ? "border-orange-200" : "border-slate-200"
      }`}
    >
      {isActive ? (
        <div className="h-1 w-full bg-gradient-to-r from-orange-400 via-orange-500 to-amber-400" />
      ) : null}

      <div className="p-5">
        {/* Top row */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-bold uppercase tracking-[0.18em] text-orange-600">
                Order #{order.orderNumber}
              </span>
              <span className="text-xs text-slate-400">{timeAgo(orderDate)}</span>
            </div>
            {/* Item preview chips */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {previewItems.map((item) => (
                <span
                  key={item.id}
                  className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-800"
                >
                  <span>{item.variantName}</span>
                  <span className="rounded-full bg-orange-200 px-1.5 py-0.5 text-[10px] font-bold text-orange-900">×{item.quantity}</span>
                </span>
              ))}
              {extraCount > 0 ? (
                <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
                  +{extraCount} more
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-sm font-semibold text-slate-700">
              ₹{order.total}
              {order.items.length > 0 ? (
                <span className="ml-1.5 text-xs font-normal text-slate-400">
                  ({order.items.length} {order.items.length === 1 ? "item" : "items"})
                </span>
              ) : null}
            </p>
          </div>
          <StatusChip status={order.orderStatus} />
        </div>

        {/* Status timeline for active orders */}
        {isActive ? (
          <div className="mt-4">
            <OrderTimeline status={order.orderStatus} />
          </div>
        ) : null}

        {/* Status message */}
        <p className="mt-3 text-sm text-slate-500">
          {getDeliveryStatusCopy({
            orderStatus: order.orderStatus,
            deliveryStatus: order.deliveryStatus,
            riderName: order.assignedRiderName,
          })}
        </p>

        {/* Delivered timestamp */}
        {order.orderStatus === "delivered" && order.deliveredAt ? (
          <p className="mt-1 text-xs text-emerald-600">
            Delivered{" "}
            {(() => {
              const da = order.deliveredAt;
              if (da && typeof da === "object" && "toDate" in da && typeof (da as { toDate: () => Date }).toDate === "function") {
                return (da as { toDate: () => Date }).toDate().toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                  hour: "numeric",
                  minute: "2-digit",
                });
              }
              return "";
            })()}
          </p>
        ) : null}

        {/* Footer */}
        <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="flex items-center gap-1 text-xs font-semibold text-slate-500 transition-colors hover:text-slate-800"
          >
            {expanded ? <ChevronUp size={14} strokeWidth={2} /> : <ChevronDown size={14} strokeWidth={2} />}
            {expanded ? "Hide details" : "Item details"}
          </button>

          <Link
            href={`/orders/${order.id}`}
            className="flex items-center gap-1.5 rounded-2xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-orange-600"
          >
            {isActive ? "Track Order" : "View Order"}
            <ArrowRight size={13} strokeWidth={2.5} />
          </Link>
        </div>

        {/* Expanded items */}
        {expanded ? (
          <div className="mt-4 space-y-2.5 border-t border-slate-100 pt-4">
            {order.items.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900">{item.variantName}</p>
                  <p className="text-xs text-slate-500">{item.categoryName} × {item.quantity}</p>
                  {item.modifiers.length > 0 ? (
                    <p className="mt-1 text-xs text-slate-400">
                      {item.modifiers.map((m) => m.name).join(" · ")}
                    </p>
                  ) : null}
                </div>
                <span className="shrink-0 text-sm font-black text-slate-900">₹{item.totalPrice}</span>
              </div>
            ))}

            <div className="rounded-2xl border border-slate-200 px-4 py-3 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal</span><span>₹{order.subtotal}</span>
              </div>
              <div className="mt-1 flex justify-between text-slate-600">
                <span>Delivery fee</span><span>₹{order.deliveryFee}</span>
              </div>
              <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 font-black text-slate-900">
                <span>Total</span><span>₹{order.total}</span>
              </div>
            </div>

            {order.address ? (
              <div className="rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-600">
                <p className="font-semibold text-slate-800">{order.address.label}</p>
                <p>{order.address.addressLine1}</p>
                {order.address.addressLine2 ? <p>{order.address.addressLine2}</p> : null}
                {order.address.landmark ? <p>Near {order.address.landmark}</p> : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

// ── Filter types ───────────────────────────────────────────────────────

type StatusFilter = "all" | "active" | "delivered" | "cancelled";
type DateFilter = "all" | "today" | "week" | "month";

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

const DATE_FILTER_OPTIONS: { value: DateFilter; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
];

function matchesDateFilter(order: OrderRecord, filter: DateFilter): boolean {
  if (filter === "all") return true;
  const orderDate = getOrderDate(order);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (filter === "today") return orderDate >= startOfToday;
  if (filter === "week") {
    const weekAgo = new Date(startOfToday);
    weekAgo.setDate(weekAgo.getDate() - 7);
    return orderDate >= weekAgo;
  }
  if (filter === "month") {
    const monthAgo = new Date(startOfToday);
    monthAgo.setMonth(monthAgo.getMonth() - 1);
    return orderDate >= monthAgo;
  }
  return true;
}

function matchesStatusFilter(order: OrderRecord, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "active") return ACTIVE_STATUSES.includes(order.orderStatus);
  if (filter === "delivered") return order.orderStatus === "delivered";
  if (filter === "cancelled") return order.orderStatus === "cancelled";
  return true;
}

// ── Main page ──────────────────────────────────────────────────────────

export default function OrdersPage() {
  const { authenticated, loading, role, customerPhone } = requireCustomer();
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!authenticated || !customerPhone) {
      setOrders([]);
      setOrdersLoading(false);
      return;
    }

    console.log("[OrdersPage] subscribing, customerPhone:", customerPhone);
    setOrdersLoading(true);
    setFetchError(null);

    const unsub = subscribeToUserOrders(
      customerPhone,
      (nextOrders) => {
        console.log("[OrdersPage] received", nextOrders.length, "orders for", customerPhone);
        setOrders(nextOrders);
        setOrdersLoading(false);
        setFetchError(null);
      },
      (error) => {
        console.error("[OrdersPage] subscription error:", error);
        setFetchError(`Failed to load orders: ${error.message}`);
        setOrdersLoading(false);
      },
    );

    return unsub;
  }, [authenticated, customerPhone]);

  const filteredOrders = useMemo(
    () => orders.filter((o) => matchesStatusFilter(o, statusFilter) && matchesDateFilter(o, dateFilter)),
    [orders, statusFilter, dateFilter],
  );

  const activeCount = useMemo(
    () => orders.filter((o) => ACTIVE_STATUSES.includes(o.orderStatus)).length,
    [orders],
  );

  if (loading) {
    return (
      <main className="min-h-screen bg-[linear-gradient(180deg,#fff8ed_0%,#ffe7cf_100%)] px-4 pt-6 md:pt-20">
        <div className="mx-auto max-w-4xl">
          <div className="h-32 animate-pulse rounded-[28px] bg-orange-100" />
        </div>
      </main>
    );
  }

  if (!authenticated || role !== "customer") {
    return null;
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#fff8ed_0%,#ffe7cf_100%)] px-4 pb-28 pt-6 text-slate-900 md:pb-12 md:pt-20">
      <div className="mx-auto max-w-4xl space-y-4">

        {/* ── Header ──────────────────────────────────────────────── */}
        <header className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-[0_20px_60px_rgba(194,65,12,0.10)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-600">Dajaj</p>
              <h1 className="mt-1 text-3xl font-black">Your Orders</h1>
              <p className="mt-1.5 text-sm text-slate-500">
                {ordersLoading ? "Loading..." : (
                  <>
                    {orders.length} total
                    {activeCount > 0 && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-bold text-orange-700">
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-500 opacity-75" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-orange-600" />
                        </span>
                        {activeCount} active
                      </span>
                    )}
                  </>
                )}
              </p>
            </div>

            {/* Date filter */}
            <div className="relative shrink-0">
              <select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value as DateFilter)}
                className="appearance-none rounded-2xl border border-slate-200 bg-slate-50 py-2.5 pl-4 pr-8 text-sm font-semibold text-slate-700 outline-none focus:border-orange-400"
              >
                {DATE_FILTER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" strokeWidth={2.5} />
            </div>
          </div>

          {/* Status filter pills */}
          <div className="mt-4 flex gap-2 overflow-x-auto pb-0.5">
            {STATUS_FILTER_OPTIONS.map((opt) => {
              const count =
                opt.value === "all" ? orders.length
                : opt.value === "active" ? orders.filter((o) => ACTIVE_STATUSES.includes(o.orderStatus)).length
                : orders.filter((o) => o.orderStatus === opt.value).length;

              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setStatusFilter(opt.value)}
                  className={`shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
                    statusFilter === opt.value
                      ? "border-orange-500 bg-orange-500 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-orange-300 hover:text-orange-600"
                  }`}
                >
                  {opt.label}
                  {count > 0 && (
                    <span className={`ml-1.5 text-xs ${statusFilter === opt.value ? "opacity-80" : "text-slate-400"}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </header>

        {/* ── Error banner ───────────────────────────────────────── */}
        {fetchError && (
          <div className="mb-3 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <span className="mt-0.5 shrink-0">⚠</span>
            <span>{fetchError}</span>
          </div>
        )}

        {/* ── Orders list ─────────────────────────────────────────── */}
        {ordersLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((n) => (
              <div key={n} className="h-40 animate-pulse rounded-[28px] bg-orange-50" />
            ))}
          </div>
        ) : filteredOrders.length === 0 ? (
          <section className="flex flex-col items-center gap-3 rounded-[28px] border border-dashed border-orange-200 bg-white p-12 text-center shadow-sm">
            <svg viewBox="0 0 48 48" className="h-10 w-10 text-orange-200" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="24" cy="24" r="20" />
              <path d="M24 14v10M24 32v2" strokeLinecap="round" />
            </svg>
            <div>
              <p className="font-bold text-slate-700">No orders found</p>
              <p className="mt-1 text-sm text-slate-400">
                {statusFilter !== "all" || dateFilter !== "all"
                  ? "Try changing your filters."
                  : "You have not placed any orders yet."}
              </p>
            </div>
            <Link href="/menu" className="mt-1 rounded-2xl bg-orange-600 px-5 py-2.5 text-sm font-semibold text-white">
              Browse Menu
            </Link>
          </section>
        ) : (
          <div className="space-y-3">
            {filteredOrders.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
        )}

      </div>

      <CustomerNavBar />
    </main>
  );
}

