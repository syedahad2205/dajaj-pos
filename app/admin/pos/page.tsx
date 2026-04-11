"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { requireAdmin } from "@/lib/roleGuard";
import {
  subscribeToPosStaff,
  updatePosStaffStatus,
  type PosStaff,
  type PosStaffStatus,
} from "@/lib/firestore";

function StatusBadge({ status }: { status: PosStaffStatus }) {
  const map: Record<PosStaffStatus, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    active: "bg-green-100 text-green-800",
    rejected: "bg-red-100 text-red-800",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${map[status]}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function StaffRow({
  staff,
  onApprove,
  onReject,
  updating,
}: {
  staff: PosStaff;
  onApprove?: () => void;
  onReject?: () => void;
  updating: boolean;
}) {
  const createdAt =
    staff.createdAt && typeof staff.createdAt === "object" && "toDate" in staff.createdAt
      ? (staff.createdAt as { toDate: () => Date }).toDate().toLocaleDateString("en-IN")
      : "";

  return (
    <div className="flex items-center justify-between gap-3 py-3 border-b border-neutral-100 last:border-0">
      <div className="min-w-0">
        <p className="font-semibold text-sm text-neutral-800 truncate">{staff.name}</p>
        <p className="text-xs text-neutral-500 truncate">{staff.email}</p>
        {createdAt && <p className="text-xs text-neutral-400 mt-0.5">Requested {createdAt}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <StatusBadge status={staff.status} />
        {onApprove && (
          <button
            onClick={onApprove}
            disabled={updating}
            className="px-3 py-1 text-xs font-semibold rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
          >
            {staff.status === "rejected" ? "Re-activate" : "Approve"}
          </button>
        )}
        {onReject && staff.status !== "rejected" && (
          <button
            onClick={onReject}
            disabled={updating}
            className="px-3 py-1 text-xs font-semibold rounded-lg bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50"
          >
            Reject
          </button>
        )}
      </div>
    </div>
  );
}

export default function AdminPosStaffPage() {
  const { authenticated, loading, role } = requireAdmin();
  const [staffList, setStaffList] = useState<PosStaff[]>([]);
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    if (!authenticated || role !== "admin") return;
    const unsub = subscribeToPosStaff(setStaffList);
    return unsub;
  }, [authenticated, role]);

  const handleStatus = async (docId: string, status: PosStaffStatus) => {
    setUpdating(docId);
    try {
      await updatePosStaffStatus(docId, status);
    } finally {
      setUpdating(null);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-[#fff8ed] flex items-center justify-center">
        <p className="text-neutral-500">Checking session…</p>
      </main>
    );
  }

  if (!authenticated || role !== "admin") return null;

  const pending = staffList.filter((s) => s.status === "pending");
  const active = staffList.filter((s) => s.status === "active");
  const rejected = staffList.filter((s) => s.status === "rejected");

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-8 max-w-2xl mx-auto">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/admin" className="text-orange-600 hover:underline text-sm">
          ← Admin
        </Link>
        <h1 className="text-xl font-bold text-neutral-800">POS Staff Requests</h1>
      </div>

      {/* Pending */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold text-neutral-500 uppercase tracking-wide mb-2">
          Pending Requests{pending.length > 0 && <span className="ml-2 bg-yellow-500 text-white text-xs rounded-full px-1.5 py-0.5">{pending.length}</span>}
        </h2>
        <div className="bg-white rounded-2xl shadow-sm px-4">
          {pending.length === 0 ? (
            <p className="py-4 text-sm text-neutral-400 text-center">No pending requests</p>
          ) : (
            pending.map((s) => (
              <StaffRow
                key={s.docId}
                staff={s}
                onApprove={() => handleStatus(s.docId, "active")}
                onReject={() => handleStatus(s.docId, "rejected")}
                updating={updating === s.docId}
              />
            ))
          )}
        </div>
      </section>

      {/* Active */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold text-neutral-500 uppercase tracking-wide mb-2">
          Active Staff
        </h2>
        <div className="bg-white rounded-2xl shadow-sm px-4">
          {active.length === 0 ? (
            <p className="py-4 text-sm text-neutral-400 text-center">No active staff</p>
          ) : (
            active.map((s) => (
              <StaffRow
                key={s.docId}
                staff={s}
                onReject={() => handleStatus(s.docId, "rejected")}
                updating={updating === s.docId}
              />
            ))
          )}
        </div>
      </section>

      {/* Rejected */}
      {rejected.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-neutral-500 uppercase tracking-wide mb-2">
            Rejected
          </h2>
          <div className="bg-white rounded-2xl shadow-sm px-4">
            {rejected.map((s) => (
              <StaffRow
                key={s.docId}
                staff={s}
                onApprove={() => handleStatus(s.docId, "active")}
                updating={updating === s.docId}
              />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
