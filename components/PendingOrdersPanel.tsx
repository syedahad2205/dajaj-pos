"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  acceptPendingOrder,
  rejectPendingOrder,
  subscribeToPendingOrders,
  type PendingOrderRecord,
} from "@/services/pendingOrderService";

const RESTAURANT_ID = "dajaj_main";

const CHANNEL_LABELS: Record<string, { label: string; color: string }> = {
  whatsapp: { label: "WhatsApp", color: "bg-green-100 text-green-800" },
  website: { label: "Website", color: "bg-blue-100 text-blue-800" },
  qr: { label: "QR", color: "bg-purple-100 text-purple-800" },
  swiggy: { label: "Swiggy", color: "bg-orange-100 text-orange-800" },
  zomato: { label: "Zomato", color: "bg-red-100 text-red-800" },
};

function formatCreatedAt(value: unknown): string {
  if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toLocaleString();
  }
  return "Just now";
}

function getRelativeTime(value: unknown): string {
  if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate: unknown }).toDate === "function") {
    const date = (value as { toDate: () => Date }).toDate();
    const diffMs = Date.now() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return `${Math.floor(diffHr / 24)}d ago`;
  }
  return "just now";
}

interface RejectModalProps {
  order: PendingOrderRecord;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  loading: boolean;
}

function RejectModal({ order, onConfirm, onCancel, loading }: RejectModalProps) {
  const [reason, setReason] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const isValid = reason.trim().length >= 1 && reason.trim().length <= 200;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reject-modal-title"
    >
      <div className="mx-4 w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h3 id="reject-modal-title" className="text-lg font-bold text-slate-900">
          Reject Order #{order.orderNumber}
        </h3>
        <p className="mt-1 text-sm text-slate-500">
          Please provide a reason for rejecting this order (1–200 characters).
        </p>

        <textarea
          ref={inputRef}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
          rows={3}
          placeholder="Enter rejection reason..."
          className="mt-4 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400"
          aria-label="Rejection reason"
        />
        <p className="mt-1 text-xs text-slate-400">
          {reason.trim().length}/200 characters
        </p>

        <div className="mt-4 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason.trim())}
            disabled={!isValid || loading}
            className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {loading ? "Rejecting…" : "Reject Order"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PendingOrdersPanel() {
  const [orders, setOrders] = useState<PendingOrderRecord[]>([]);
  const [disconnected, setDisconnected] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejectingOrder, setRejectingOrder] = useState<PendingOrderRecord | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToPendingOrders(
      RESTAURANT_ID,
      (pendingOrders) => {
        setOrders(pendingOrders);
        setDisconnected(false);
      },
      () => {
        setDisconnected(true);
      },
    );

    return () => unsubscribe();
  }, []);

  const handleAccept = useCallback(async (order: PendingOrderRecord) => {
    setActionLoading(order.id);
    setError(null);

    try {
      await acceptPendingOrder(order.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept order");
    } finally {
      setActionLoading(null);
    }
  }, []);

  const handleRejectConfirm = useCallback(async (reason: string) => {
    if (!rejectingOrder) return;

    setActionLoading(rejectingOrder.id);
    setError(null);

    try {
      await rejectPendingOrder(rejectingOrder.id, reason);
      setRejectingOrder(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject order");
    } finally {
      setActionLoading(null);
    }
  }, [rejectingOrder]);

  return (
    <section className="space-y-4">
      <div className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-black text-slate-900">Pending Orders</h2>
            <p className="mt-1 text-sm text-slate-600">
              Incoming orders from all channels awaiting acceptance.
            </p>
          </div>
          {orders.length > 0 && (
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-orange-600 text-sm font-bold text-white">
              {orders.length > 99 ? "99+" : orders.length}
            </span>
          )}
        </div>
      </div>

      {disconnected && (
        <div
          className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800"
          role="alert"
          aria-live="assertive"
        >
          ⚠️ Connection lost — pending orders may not be up to date. Reconnecting…
        </div>
      )}

      {error && (
        <div
          className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700"
          role="alert"
        >
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-3 text-xs underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {orders.length === 0 && !disconnected && (
        <div className="rounded-[28px] border border-slate-100 bg-white p-8 text-center">
          <p className="text-sm text-slate-500">No pending orders right now.</p>
        </div>
      )}

      {orders.map((order) => {
        const channelInfo = CHANNEL_LABELS[order.channel] || { label: order.channel, color: "bg-slate-100 text-slate-700" };
        const itemCount = order.items.reduce((sum, item) => sum + item.qty, 0);
        const isLoading = actionLoading === order.id;

        return (
          <div
            key={order.id}
            className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${channelInfo.color}`}>
                    {channelInfo.label}
                  </span>
                  <span className="text-sm font-semibold uppercase tracking-wide text-orange-600">
                    #{order.orderNumber}
                  </span>
                </div>
                <h3 className="text-lg font-bold text-slate-900">{order.customerName}</h3>
                {order.customerPhone && (
                  <p className="text-sm text-slate-500">{order.customerPhone}</p>
                )}
                <p className="text-sm text-slate-500">
                  {itemCount} item{itemCount !== 1 ? "s" : ""} • {formatCreatedAt(order.createdAt)}
                </p>
                <p className="text-xs text-slate-400">{getRelativeTime(order.createdAt)}</p>
              </div>

              <div className="space-y-2 sm:text-right">
                <p className="text-2xl font-black text-slate-900">₹{order.total.toFixed(2)}</p>
                <p className="text-xs capitalize text-slate-500">
                  {order.orderType.replace("_", " ")}
                </p>
              </div>
            </div>

            {order.items.length > 0 && (
              <div className="mt-4 rounded-xl bg-slate-50 p-3">
                <p className="mb-1 text-xs font-semibold text-slate-500">Items</p>
                {order.items.slice(0, 5).map((item, idx) => (
                  <p key={idx} className="text-sm text-slate-700">
                    {item.qty}× {item.name} — ₹{item.total.toFixed(2)}
                  </p>
                ))}
                {order.items.length > 5 && (
                  <p className="text-xs text-slate-400">
                    +{order.items.length - 5} more item{order.items.length - 5 !== 1 ? "s" : ""}
                  </p>
                )}
              </div>
            )}

            {order.notes && (
              <p className="mt-3 text-sm italic text-slate-500">Note: {order.notes}</p>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleAccept(order)}
                disabled={isLoading}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                aria-label={`Accept order ${order.orderNumber}`}
              >
                {isLoading && actionLoading === order.id ? "Accepting…" : "Accept"}
              </button>
              <button
                type="button"
                onClick={() => setRejectingOrder(order)}
                disabled={isLoading}
                className="rounded-xl border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-50"
                aria-label={`Reject order ${order.orderNumber}`}
              >
                Reject
              </button>
            </div>
          </div>
        );
      })}

      {rejectingOrder && (
        <RejectModal
          order={rejectingOrder}
          onConfirm={handleRejectConfirm}
          onCancel={() => setRejectingOrder(null)}
          loading={actionLoading === rejectingOrder.id}
        />
      )}
    </section>
  );
}
