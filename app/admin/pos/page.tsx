"use client";

import { requireAdmin } from "@/lib/roleGuard";
import PosPage from "@/app/pos/page";

export default function AdminPosPage() {
  const { authenticated, loading, role } = requireAdmin();

  if (loading) {
    return <main className="min-h-screen bg-[#fff8ed] px-4 py-10">Checking your session...</main>;
  }

  if (!authenticated || role !== "admin") {
    return null;
  }

  return <PosPage />;
}
