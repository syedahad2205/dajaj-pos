"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Check, X, LogOut, Phone, Calendar, ShoppingBag, IndianRupee, ChevronRight } from "lucide-react";
import { requireCustomer } from "@/lib/roleGuard";
import { useCustomerAuth } from "@/components/auth/CustomerAuthProvider";
import { updateCustomerProfile } from "@/services/customerService";
import { subscribeToUserOrders } from "@/services/orderService";
import CustomerNavBar from "@/components/CustomerNavBar";

function formatDisplayPhone(phone: string): string {
  if (phone.startsWith("91") && phone.length === 12) {
    const number = phone.slice(2);
    return `+91 ${number.slice(0, 5)} ${number.slice(5)}`;
  }
  return `+${phone}`;
}

function formatMemberSince(value: unknown): string {
  if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toLocaleDateString("en-IN", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }
  return "—";
}

function getInitials(name: string): string {
  const parts = name.trim().split(" ").filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function ProfileContent() {
  const router = useRouter();
  const { authenticated, loading, role, customer, customerPhone } = requireCustomer();
  const { clearCustomerSession, refreshCustomer } = useCustomerAuth();

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const [orderCount, setOrderCount] = useState(0);
  const [totalSpent, setTotalSpent] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    if (!authenticated || !customerPhone) return;
    const unsub = subscribeToUserOrders(customerPhone, (orders) => {
      setOrderCount(orders.length);
      setTotalSpent(orders.reduce((sum, o) => sum + o.total, 0));
      setActiveCount(
        orders.filter((o) =>
          ["pending", "accepted", "preparing", "ready", "out_for_delivery"].includes(o.orderStatus),
        ).length,
      );
      setStatsLoading(false);
    });
    return unsub;
  }, [authenticated, customerPhone]);

  const handleStartEdit = () => {
    setEditName(customer?.name ?? "");
    setSaveError("");
    setEditing(true);
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setSaveError("");
  };

  const handleSave = async () => {
    if (!customerPhone) return;
    const trimmed = editName.trim();
    if (!trimmed) {
      setSaveError("Name cannot be empty.");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      await updateCustomerProfile(customerPhone, { name: trimmed, dob: customer?.dob });
      await refreshCustomer();
      setEditing(false);
    } catch {
      setSaveError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = () => {
    clearCustomerSession();
    router.push("/login");
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-[linear-gradient(180deg,#fff8ed_0%,#ffe7cf_100%)] px-4 py-6 md:pt-20">
        <div className="mx-auto max-w-2xl">
          <div className="h-48 animate-pulse rounded-[28px] bg-orange-100" />
        </div>
      </main>
    );
  }

  if (!authenticated || role !== "customer" || !customer) {
    return null;
  }

  const initials = getInitials(customer.name || customerPhone || "?");

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#fff8ed_0%,#ffe7cf_100%)] px-4 pb-24 pt-6 text-slate-900 md:pb-10 md:pt-20">
      <div className="mx-auto max-w-2xl space-y-4">

        {/* ── Avatar + Identity ─────────────────────────────────────── */}
        <section className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-[0_20px_60px_rgba(194,65,12,0.10)]">
          <div className="flex items-start gap-5">
            {/* Avatar circle */}
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-orange-600 shadow-lg">
              <span className="text-2xl font-black tracking-tight text-white">{initials}</span>
            </div>

            <div className="min-w-0 flex-1">
              {/* Name row */}
              {editing ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleSave();
                      if (e.key === "Escape") handleCancelEdit();
                    }}
                    autoFocus
                    maxLength={60}
                    className="w-full rounded-2xl border-2 border-orange-400 bg-orange-50 px-4 py-2.5 text-xl font-black text-slate-900 outline-none focus:border-orange-500"
                    placeholder="Your name"
                  />
                  {saveError && (
                    <p className="text-xs font-medium text-rose-500">{saveError}</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void handleSave()}
                      disabled={saving}
                      className="flex items-center gap-1.5 rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      <Check size={14} strokeWidth={2.5} />
                      {saving ? "Saving..." : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelEdit}
                      disabled={saving}
                      className="flex items-center gap-1.5 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600"
                    >
                      <X size={14} strokeWidth={2.5} />
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-2xl font-black text-slate-900">
                    {customer.name || "No name set"}
                  </h1>
                  <button
                    type="button"
                    onClick={handleStartEdit}
                    className="shrink-0 rounded-xl border border-slate-200 p-1.5 text-slate-400 transition-colors hover:border-orange-300 hover:text-orange-500"
                    aria-label="Edit name"
                  >
                    <Pencil size={14} strokeWidth={2} />
                  </button>
                </div>
              )}

              {/* Phone */}
              <div className="mt-2 flex items-center gap-1.5 text-sm text-slate-500">
                <Phone size={13} strokeWidth={1.8} />
                <span className="font-medium">{formatDisplayPhone(customerPhone ?? "")}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Cannot change
                </span>
              </div>

              {/* Member since */}
              <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-400">
                <Calendar size={12} strokeWidth={1.8} />
                Member since {formatMemberSince(customer.createdAt)}
              </div>
            </div>
          </div>
        </section>

        {/* ── Stats ─────────────────────────────────────────────────── */}
        <section className="grid grid-cols-3 gap-3">
          <div className="rounded-[20px] border border-orange-100 bg-white p-4 text-center shadow-sm">
            <ShoppingBag size={20} className="mx-auto mb-1.5 text-orange-500" strokeWidth={1.8} />
            <p className="text-2xl font-black text-slate-900">
              {statsLoading ? "—" : orderCount}
            </p>
            <p className="mt-0.5 text-xs font-medium text-slate-500">Orders</p>
          </div>
          <div className="rounded-[20px] border border-orange-100 bg-white p-4 text-center shadow-sm">
            <IndianRupee size={20} className="mx-auto mb-1.5 text-orange-500" strokeWidth={1.8} />
            <p className="text-2xl font-black text-slate-900">
              {statsLoading ? "—" : `₹${totalSpent}`}
            </p>
            <p className="mt-0.5 text-xs font-medium text-slate-500">Total spent</p>
          </div>
          <div className="rounded-[20px] border border-orange-100 bg-white p-4 text-center shadow-sm">
            <div className="mx-auto mb-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-orange-400 bg-orange-50">
              <span className="text-[10px] font-black leading-none text-orange-600">
                {statsLoading ? "·" : activeCount}
              </span>
            </div>
            <p className="text-2xl font-black text-slate-900">
              {statsLoading ? "—" : activeCount}
            </p>
            <p className="mt-0.5 text-xs font-medium text-slate-500">Active</p>
          </div>
        </section>

        {/* ── Quick links ───────────────────────────────────────────── */}
        <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
          <button
            type="button"
            onClick={() => router.push("/orders")}
            className="flex w-full items-center justify-between px-6 py-5 transition-colors hover:bg-orange-50"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-orange-50">
                <ShoppingBag size={16} className="text-orange-600" strokeWidth={2} />
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-slate-900">Order History</p>
                <p className="text-xs text-slate-500">View all your past orders</p>
              </div>
            </div>
            <ChevronRight size={16} className="text-slate-400" strokeWidth={2} />
          </button>
        </section>

        {/* ── Sign out ──────────────────────────────────────────────── */}
        <section className="rounded-[28px] border border-rose-100 bg-white shadow-sm">
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center justify-between rounded-[28px] px-6 py-5 transition-colors hover:bg-rose-50"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-rose-50">
                <LogOut size={16} className="text-rose-500" strokeWidth={2} />
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-rose-600">Sign Out</p>
                <p className="text-xs text-slate-500">You&apos;ll need to verify your phone again</p>
              </div>
            </div>
            <ChevronRight size={16} className="text-rose-300" strokeWidth={2} />
          </button>
        </section>

      </div>

      <CustomerNavBar />
    </main>
  );
}

export default function ProfilePage() {
  return <ProfileContent />;
}
