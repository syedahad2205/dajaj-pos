"use client";

import Link from "next/link";
import { requireAdmin } from "@/lib/roleGuard";
import FinanceNav from "@/components/finance/FinanceNav";

const links = [
  { href: "/admin/finance/categories", title: "Expense & Income Categories", description: "Manage the categories used in Daily Closing and Transactions — Chicken, Vegetables, Packaging, Salary, Zomato, UPI, and so on." },
  { href: "/admin/finance/accounts", title: "Accounts", description: "Cash Drawer, Canara, IDBI, ICICI, Pigmi — the accounts used by the Transactions tab. Balances update automatically." },
  { href: "/admin/finance/settings/defaults", title: "Finance Defaults", description: "Configure where Daily Closing and automatic financial events are posted. Changing these settings only affects future transactions." },
  { href: "/admin/finance/settings/pigmi", title: "Pigmi Settings", description: "Track total Pigmi deposits collected over time." },
  { href: "/admin/finance/settings/locks", title: "Lock Settings", description: "See which days are locked and reopen a day if it needs correcting." },
  { href: "/admin/finance/settings/users", title: "Finance Users", description: "Create logins for the Daily Closing mobile app — cashiers and managers, separate from DAJAJ Admin accounts." },
  { href: "/admin/finance/vendors", title: "Vendors", description: "Supplier records and purchase history — vendor tagging on Transactions is planned for a later phase." },
  { href: "/admin/finance/settings/audit-log", title: "Audit Log", description: "Every finance change, from every account — Admin and Finance Manager. Who did what, when, and the before/after values." },
];

export default function FinanceSettingsPage() {
  const { authenticated, loading, role } = requireAdmin();
  if (loading) {
    return <main className="min-h-screen bg-[#fff8ed] px-4 py-10 text-slate-900">Checking your session…</main>;
  }
  if (!authenticated || role !== "admin") return null;

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-orange-600">Finance</p>
          <h1 className="mt-1 text-3xl font-black">Settings</h1>
          <p className="mt-2 text-sm text-slate-600">Configuration and advanced features, kept out of the daily workflow.</p>
          <div className="mt-5">
            <FinanceNav />
          </div>
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <h2 className="text-lg font-black text-slate-900">{link.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{link.description}</p>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
