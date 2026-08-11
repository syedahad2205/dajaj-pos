"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/admin/finance", label: "Dashboard" },
  { href: "/admin/finance/closing", label: "⭐ Daily Closing" },
  { href: "/admin/finance/transactions", label: "Transactions" },
  { href: "/admin/finance/reports", label: "Reports" },
  { href: "/admin/finance/settings", label: "Settings" },
];

export default function FinanceNav() {
  const pathname = usePathname();

  return (
    <nav className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabs.map((tab) => {
        const active = tab.href === "/admin/finance" ? pathname === tab.href : pathname?.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex-shrink-0 whitespace-nowrap rounded-2xl px-4 py-2.5 text-sm font-semibold transition ${
              active ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
