"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShoppingBag, ClipboardList, UserCircle } from "lucide-react";
import { useCart } from "@/components/cart/CartProvider";

const NAV_ITEMS = [
  {
    href: "/menu",
    label: "Menu",
    Icon: ShoppingBag,
  },
  {
    href: "/orders",
    label: "Orders",
    Icon: ClipboardList,
  },
  {
    href: "/profile",
    label: "Profile",
    Icon: UserCircle,
  },
] as const;

export default function CustomerNavBar() {
  const pathname = usePathname();
  const { itemCount } = useCart();

  return (
    <>
      {/* ── Desktop top nav ─────────────────────────────────────────── */}
      <nav className="fixed left-0 right-0 top-0 z-40 hidden border-b border-orange-100 bg-white/90 backdrop-blur md:block">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-6">
          <Link href="/menu" className="text-base font-black tracking-tight text-orange-600">
            Dajaj
          </Link>
          <div className="flex items-center gap-1">
            {NAV_ITEMS.map(({ href, label, Icon }) => {
              const isActive = pathname === href || (href !== "/menu" && pathname.startsWith(href));
              const isMenu = href === "/menu";

              return (
                <Link
                  key={href}
                  href={href}
                  className={`relative flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
                    isActive
                      ? "bg-orange-50 text-orange-600"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  }`}
                >
                  <Icon size={16} strokeWidth={isActive ? 2.5 : 1.8} />
                  {label}
                  {isMenu && itemCount > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-orange-600 text-[10px] font-bold text-white">
                      {itemCount > 9 ? "9+" : itemCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      {/* ── Mobile bottom nav ───────────────────────────────────────── */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-orange-100 bg-white/95 backdrop-blur md:hidden">
        <div className="flex h-16 items-stretch">
          {NAV_ITEMS.map(({ href, label, Icon }) => {
            const isActive = pathname === href || (href !== "/menu" && pathname.startsWith(href));
            const isMenu = href === "/menu";

            return (
              <Link
                key={href}
                href={href}
                className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors ${
                  isActive ? "text-orange-600" : "text-slate-400"
                }`}
              >
                <span className="relative">
                  <Icon
                    size={22}
                    strokeWidth={isActive ? 2.5 : 1.8}
                    className={isActive ? "text-orange-600" : "text-slate-400"}
                  />
                  {isMenu && itemCount > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-orange-600 text-[10px] font-bold text-white leading-none">
                      {itemCount > 9 ? "9+" : itemCount}
                    </span>
                  )}
                </span>
                <span className={`text-[10px] font-semibold leading-none ${isActive ? "text-orange-600" : "text-slate-400"}`}>
                  {label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
