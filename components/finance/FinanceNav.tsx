"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { UserRole } from "@/lib/firebase";

const tabs = [
  { href: "/admin/finance", label: "Dashboard" },
  { href: "/admin/finance/closing", label: "⭐ Daily Closing" },
  { href: "/admin/finance/quick-entry", label: "Quick Entry" },
  { href: "/admin/finance/transactions", label: "Transactions" },
  { href: "/admin/finance/quick-entry/passbook", label: "Passbook" },
  { href: "/admin/finance/reports", label: "Reports" },
  { href: "/admin/finance/quick-entry/activity", label: "Activity Log" },
  // Zomato/Swiggy Sales Trackers live under /admin (not /admin/finance) since
  // they predate this nav and have their own hub pages, but they're
  // Finance-adjacent (settlement reconciliation posts straight into Finance)
  // so they're linked from here too. Admin-only, same as Settings/AI
  // Assistant below — see role filter.
  { href: "/admin/zomato", label: "Zomato" },
  { href: "/admin/swiggy", label: "Swiggy" },
  // Accounts, Vendors, Categories, Finance Users, and Lock Settings all live
  // under this tab — Finance Manager never sees it (see role filter below),
  // since that role is scoped to Dashboard/Daily Closing/Transactions/Reports
  // plus the Quick Entry/Passbook/Activity Log tabs added above.
  { href: "/admin/finance/settings", label: "Settings" },
  // Admin-only for now (see role filter below AND firestore.rules'
  // finance_ai_chat_messages, which is gated to isAdmin() alone) — unlike
  // Settings, this isn't demoted-but-visible-elsewhere, it's simply not
  // offered to a Finance Manager account at all yet.
  { href: "/admin/finance/ai-chat", label: "🤖 AI Assistant" },
];

const FINANCE_MANAGER_HIDDEN_TABS = new Set(["/admin/finance/settings", "/admin/finance/ai-chat", "/admin/zomato", "/admin/swiggy"]);

export default function FinanceNav({ role }: { role?: UserRole | null } = {}) {
  const pathname = usePathname();
  const visibleTabs = role === "financeManager" ? tabs.filter((tab) => !FINANCE_MANAGER_HIDDEN_TABS.has(tab.href)) : tabs;

  return (
    <nav className="flex flex-wrap gap-1.5 sm:gap-2">
      {visibleTabs.map((tab) => {
        const active = tab.href === "/admin/finance" ? pathname === tab.href : pathname?.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`whitespace-nowrap rounded-2xl px-3 py-2 text-xs font-semibold transition sm:px-4 sm:py-2.5 sm:text-sm ${
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
