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
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);
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
              const isExpanded = expandedCategoryId === category.id;
              const variants = collectVariants(category).filter((n) => n.type === "variant");

              return (
                <section key={category.id} className="rounded-[28px] border border-orange-100 bg-white/90 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setExpandedCategoryId((prev) => (prev === category.id ? null : category.id))}
                    className="flex w-full items-center justify-between gap-4 px-5 py-5 text-left"
                  >
                    <div>
                      <h2 className="break-words text-2xl font-black text-slate-900">
                        {isExpanded ? "▼" : "►"} {category.name}
                      </h2>
                      <p className="mt-1 text-sm font-medium text-slate-500">
                        {variants.length} {variants.length === 1 ? "item" : "items"}
                      </p>
                      {category.description ? <p className="mt-2 text-sm leading-6 text-slate-600">{category.description}</p> : null}
                    </div>
                  </button>

                  {isExpanded ? (
                    <div className="border-t border-orange-100 px-5 py-5">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {variants.map((v) => (
                          <article key={v.id} className="flex w-full flex-col gap-3 overflow-hidden rounded-2xl border border-orange-100 bg-white p-4 shadow transition hover:shadow-lg">
                            <div className="relative h-36 w-full overflow-hidden rounded-xl bg-gradient-to-br from-orange-100 via-amber-50 to-white">
                              {v.imageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={v.imageUrl} alt={v.name} className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full items-center justify-center text-sm font-bold uppercase tracking-[0.3em] text-orange-500">No Image</div>
                              )}
                            </div>
                            <div className="space-y-1">
                              <div className="flex items-start justify-between gap-4">
                                <div>
                                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-600">{category.name}</p>
                                  <h3 className="break-words text-lg font-black text-slate-900">{v.name}</h3>
                                  {v.description ? <p className="mt-1 text-sm leading-6 text-slate-600">{v.description}</p> : null}
                                </div>
                                <span className="whitespace-nowrap text-lg font-black text-slate-900">₹{v.price}</span>
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </section>
              );
            })}
          </section>
        )}
      </div>
    </main>
  );
}
