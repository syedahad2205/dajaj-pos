"use client";

import { requireAdmin } from "@/lib/roleGuard";
import FinanceNav from "@/components/finance/FinanceNav";

export default function FinanceUsersSettingsPage() {
  const { authenticated, loading, role } = requireAdmin();
  if (loading) {
    return <main className="min-h-screen bg-[#fff8ed] px-4 py-10 text-slate-900">Checking your session…</main>;
  }
  if (!authenticated || role !== "admin") return null;

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-3xl space-y-5">
        <header className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-orange-600">Finance · Settings</p>
          <h1 className="mt-1 text-3xl font-black">Users</h1>
          <p className="mt-2 text-sm text-slate-600">
            Manager, Cashier, and Accountant roles with scoped permissions are planned for a later phase. Everything in
            Finance is admin-only for now, the same as the rest of the DAJAJ admin app.
          </p>
          <div className="mt-5">
            <FinanceNav />
          </div>
        </header>

        <div className="rounded-[28px] border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
          <p className="font-semibold text-slate-400">Coming soon.</p>
        </div>
      </div>
    </main>
  );
}
