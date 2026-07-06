"use client";

import Link from "next/link";
import { requireAdmin } from "@/lib/roleGuard";

const adminLinks = [
  {
    href: "/admin/pos",
    title: "POS",
    description: "Open Point Of Sale",
  },
  {
    href: "/admin/riders",
    title: "Delivery Partners",
    description: "Manage rider accounts, availability, and active loads",
  },
  {
    href: "/admin/delivery",
    title: "Delivery Settings",
    description: "Manage delivery zones and fees",
  },
  {
    href: "/admin/orders",
    title: "Order Management",
    description: "View and manage customer orders",
  },
  {
    href: "/admin/finance/closing",
    title: "Finance",
    description: "Daily Closing — log cash expenses, Pigmi deposits, and sales, then close the books in under 2 minutes",
  },
  {
    href: "/admin/inventory",
    title: "Inventory Logs",
    description: "Review inventory updates and audit history",
  },
  {
    href: "/admin/zomato",
    title: "Zomato Sales Tracker",
    description: "Import payout CSVs, analyse item performance, and generate reports",
  },
  {
    href: "/admin/feedback",
    title: "Customer Feedback",
    description: "Review direct feedback submitted by customers via QR code packaging",
  },
];

export default function AdminDashboardPage() {
  const { authenticated, loading, role } = requireAdmin();

  if (loading) {
    return <main className="min-h-screen bg-[#fff8ed] px-4 py-10">Checking your session...</main>;
  }

  if (!authenticated || role !== "admin") {
    return null;
  }

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-5xl space-y-4">
        <header className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
          <h1 className="text-3xl font-black">Admin Dashboard</h1>
          <p className="mt-2 text-sm text-slate-600">Manage store operations, delivery setup, and customer orders from one place.</p>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          {adminLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <h2 className="text-2xl font-black text-slate-900">{link.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{link.description}</p>
            </Link>
          ))}
        </section>
      </div>
    </main>
  );
}
