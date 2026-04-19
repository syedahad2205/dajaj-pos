"use client";

import { useEffect, useMemo, useState } from "react";
import type { MenuTreeNode } from "@/lib/menu-builder";
import { getAvailableMenuTree } from "@/services/menuService";

function collectVariants(node: MenuTreeNode): MenuTreeNode[] {
  const variants: MenuTreeNode[] = [];
  for (const child of node.children) {
    if (child.type === "variant") variants.push(child);
    variants.push(...collectVariants(child));
  }
  return variants;
}

export default function MenuPage() {
  const [menuTree, setMenuTree] = useState<MenuTreeNode[]>([]);
  const [status, setStatus] = useState("Loading menu...");

  useEffect(() => {
    let cancelled = false;
    void getAvailableMenuTree()
      .then(({ tree }) => {
        if (cancelled) return;
        setMenuTree(tree);
        setStatus(tree.length === 0 ? "No menu is available right now." : "");
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setStatus(error.message || "Failed to load menu.");
      });
    return () => { cancelled = true; };
  }, []);

  const categories = useMemo(() => menuTree.filter((n) => n.type === "category"), [menuTree]);

  return (
    <main className="min-h-screen w-full overflow-x-hidden bg-[linear-gradient(180deg,#fff8ed_0%,#ffe7cf_100%)] py-6 text-slate-900">
      <div className="mx-auto w-full max-w-[900px] px-4">
        <header className="mb-6 rounded-[28px] border border-orange-200 bg-white/85 px-6 py-6 shadow-[0_20px_60px_rgba(194,65,12,0.12)] backdrop-blur text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-orange-600">Dajaj</p>
          <h1 className="mt-2 text-4xl font-black">Our Menu</h1>
        </header>

        {status ? (
          <div className="rounded-[28px] border border-orange-200 bg-white px-6 py-14 text-center text-sm font-medium text-slate-600">
            {status}
          </div>
        ) : (
          <section className="space-y-4">
            {categories.map((category) => {
              const variants = collectVariants(category).filter((n) => n.type === "variant");

              return (
                <section key={category.id} className="rounded-[28px] border border-orange-100 bg-white/90 shadow-sm">
                  <div className="px-5 py-5">
                    <h2 className="text-2xl font-black text-slate-900">{category.name}</h2>
                    <p className="mt-1 text-sm font-medium text-slate-500">
                      {variants.length} {variants.length === 1 ? "item" : "items"}
                    </p>
                    {category.description ? <p className="mt-2 text-sm leading-6 text-slate-600">{category.description}</p> : null}
                  </div>
                  <div className="border-t border-orange-100 px-5 py-5">
                    <div className="space-y-3">
                      {variants.map((v) => (
                        <div key={v.id} className="flex flex-col gap-2 rounded-3xl border border-orange-100 bg-orange-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <h3 className="text-lg font-black text-slate-900">{v.name}</h3>
                            {v.description ? <p className="mt-1 text-sm leading-6 text-slate-600">{v.description}</p> : null}
                          </div>
                          <span className="text-lg font-black text-slate-900">₹{v.price}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              );
            })}
          </section>
        )}
      </div>
    </main>
  );
}
