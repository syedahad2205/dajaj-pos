"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import CartDrawer from "@/components/cart/CartDrawer";
import { useCart } from "@/components/cart/CartProvider";
import VariantGrid from "@/components/menu/VariantGrid";
import VariantModal from "@/components/menu/VariantModal";
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

function hasModifierGroups(variant: MenuTreeNode) {
  return variant.children.some((c) => c.type === "modifierGroup");
}

const WHATSAPP_NUMBER = "917019044480";

function formatOrderMessage(
  items: ReturnType<typeof useCart>["items"],
  subtotal: number,
  orderType: "pickup" | "delivery",
) {
  const lines: string[] = [
    "Hi, I would like to place an order from Dajaj!",
    "",
    `*Order Type:* ${orderType === "pickup" ? "Pickup" : "Delivery"}`,
    "",
    "--- *ORDER DETAILS* ---",
  ];

  const grouped = new Map<string, typeof items>();
  for (const item of items) {
    const key = item.categoryName || "Other";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(item);
  }

  for (const [category, categoryItems] of grouped) {
    lines.push("", `*${category}*`);
    for (const item of categoryItems) {
      const perUnit = item.basePrice + item.modifiers.reduce((s, m) => s + m.price, 0);
      lines.push(`• ${item.variantName} x${item.quantity} — ₹${perUnit * item.quantity}`);
      if (item.modifiers.length > 0) {
        const modText = item.modifiers.map((m) => `${m.groupName}: ${m.name}${m.price > 0 ? ` (+₹${m.price})` : ""}`).join(", ");
        lines.push(`  ${modText}`);
      }
    }
  }

  const totalItems = items.reduce((s, i) => s + i.quantity, 0);
  lines.push("", "--- *TOTAL* ---", `Items: ${totalItems}`, `Subtotal: ₹${subtotal}`);

  if (orderType === "delivery") {
    lines.push("", "_Note: Delivery charges will be applied separately and collected by the delivery partner._");
  }

  return lines.join("\n");
}

function OrderTypeModal({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (type: "pickup" | "delivery") => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
        <h2 className="text-2xl font-black text-slate-900">How would you like your order?</h2>
        <p className="mt-2 text-sm text-slate-500">Choose pickup or delivery before placing your order.</p>

        <div className="mt-6 space-y-3">
          <button
            type="button"
            onClick={() => onConfirm("pickup")}
            className="w-full rounded-2xl border-2 border-slate-900 bg-slate-900 px-5 py-4 text-left text-white transition hover:bg-slate-800"
          >
            <p className="text-lg font-bold">Pickup</p>
            <p className="mt-1 text-sm text-slate-300">No extra charges — collect from store</p>
          </button>

          <button
            type="button"
            onClick={() => onConfirm("delivery")}
            className="w-full rounded-2xl border-2 border-orange-200 bg-orange-50 px-5 py-4 text-left text-slate-900 transition hover:border-orange-300 hover:bg-orange-100"
          >
            <p className="text-lg font-bold">Delivery</p>
            <p className="mt-1 text-sm text-slate-500">Extra delivery charges will be applied by the delivery partner</p>
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-xl px-4 py-3 text-sm font-semibold text-slate-500 transition hover:text-slate-700"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function CategoryMenuSheet({
  open,
  categories,
  onSelect,
  onClose,
}: {
  open: boolean;
  categories: MenuTreeNode[];
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <>
      <button type="button" onClick={onClose} className="fixed inset-0 z-40 bg-black/30" />
      <div className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-[480px] rounded-t-3xl bg-white px-5 pb-8 pt-5 shadow-[0_-12px_40px_rgba(0,0,0,0.15)]">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-slate-300" />
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Browse menu</p>
        <div className="max-h-[50vh] space-y-1 overflow-y-auto">
          {categories.map((cat) => {
            const count = collectVariants(cat).filter((n) => n.type === "variant").length;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => { onSelect(cat.id); onClose(); }}
                className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-left transition hover:bg-slate-50 active:bg-slate-100"
              >
                <span className="text-sm font-bold text-slate-900">{cat.name}</span>
                <span className="text-xs font-semibold text-slate-400">{count}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

export default function MenuPage() {
  const { items, itemCount, subtotal, addItem, updateItem, incrementItem, decrementItem } = useCart();
  const [menuTree, setMenuTree] = useState<MenuTreeNode[]>([]);
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null);
  const [editingCartItemId, setEditingCartItemId] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [orderTypeOpen, setOrderTypeOpen] = useState(false);
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [status, setStatus] = useState("Loading menu...");
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());
  const isScrollingTo = useRef(false);

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

  const categories = useMemo(() => menuTree.filter((node) => node.type === "category"), [menuTree]);

  const allVariants = useMemo(() => {
    const result: { variant: MenuTreeNode; categoryName: string }[] = [];
    for (const cat of categories) {
      for (const v of collectVariants(cat).filter((n) => n.type === "variant")) {
        result.push({ variant: v, categoryName: cat.name });
      }
    }
    return result;
  }, [categories]);

  const filteredVariants = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const q = searchQuery.toLowerCase().trim();
    return allVariants.filter(
      ({ variant, categoryName }) =>
        variant.name.toLowerCase().includes(q) ||
        categoryName.toLowerCase().includes(q) ||
        (variant.description && variant.description.toLowerCase().includes(q)),
    );
  }, [searchQuery, allVariants]);

  const variantLookup = useMemo(() => {
    const map = new Map<string, MenuTreeNode>();
    const walk = (nodes: MenuTreeNode[]) => {
      nodes.forEach((node) => { map.set(node.id, node); walk(node.children); });
    };
    walk(menuTree);
    return map;
  }, [menuTree]);

  const activeVariant = activeVariantId ? variantLookup.get(activeVariantId) ?? null : null;
  const editingItem = editingCartItemId ? items.find((item) => item.id === editingCartItemId) ?? null : null;
  const activeCategoryName = editingItem?.categoryName ?? categories.find((category) => collectVariants(category).some((variant) => variant.id === activeVariantId))?.name ?? "";

  const scrollToCategory = useCallback((id: string) => {
    const el = sectionRefs.current.get(id);
    if (!el) return;
    setSearchQuery("");
    isScrollingTo.current = true;
    const top = el.getBoundingClientRect().top + window.scrollY - 80;
    window.scrollTo({ top, behavior: "smooth" });
    setTimeout(() => { isScrollingTo.current = false; }, 600);
  }, []);

  const handleAddVariant = (variant: MenuTreeNode) => {
    setEditingCartItemId(null);
    if (hasModifierGroups(variant)) {
      setActiveVariantId(variant.id);
      return;
    }
    addItem({
      categoryName: categories.find((category) => collectVariants(category).some((entry) => entry.id === variant.id))?.name ?? "",
      variantId: variant.id,
      variantName: variant.name,
      basePrice: variant.price,
      modifiers: [],
      quantity: 1,
      totalPrice: variant.price,
      imageUrl: variant.imageUrl,
      description: variant.description,
    });
  };

  const handleCheckout = () => {
    setCartOpen(false);
    setOrderTypeOpen(true);
  };

  const handleOrderTypeConfirm = (type: "pickup" | "delivery") => {
    const message = formatOrderMessage(items, subtotal, type);
    const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank");
    setOrderTypeOpen(false);
  };

  const isSearching = Boolean(filteredVariants);

  return (
    <main className="min-h-screen w-full overflow-x-hidden bg-[#faf6f1] text-slate-900">
      {/* Header */}
      <div className="bg-[#faf6f1] px-4 pb-3 pt-8 text-center">
        <Image src="/logo.png" alt="Dajaj logo" width={56} height={56} className="mx-auto mb-2 h-auto w-auto" />
        <h1 className="text-3xl font-black tracking-tight text-slate-900">Our Menu</h1>
      </div>

      {/* Search bar */}
      <div className="sticky top-0 z-20 bg-[#faf6f1]/95 px-4 pb-3 pt-2 backdrop-blur-md">
        <div className="mx-auto max-w-[600px]">
          <div className="flex items-center gap-2 rounded-2xl bg-white px-4 py-3 shadow-[0_1px_8px_rgba(0,0,0,0.06)]">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-slate-400"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search for dishes..."
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />
            {searchQuery && (
              <button type="button" onClick={() => setSearchQuery("")} className="shrink-0 text-slate-400 hover:text-slate-600">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Menu content */}
      <div className="mx-auto w-full max-w-[600px] px-4 pb-36 pt-2">
        {status ? (
          <div className="rounded-2xl bg-white px-6 py-14 text-center text-sm font-medium text-slate-400 shadow-sm">
            {status}
          </div>
        ) : isSearching ? (
          <div>
            <p className="mb-3 px-1 text-xs font-bold uppercase tracking-[0.15em] text-slate-400">
              {filteredVariants!.length} {filteredVariants!.length === 1 ? "result" : "results"} for &ldquo;{searchQuery}&rdquo;
            </p>
            {filteredVariants!.length === 0 ? (
              <div className="rounded-2xl bg-white px-6 py-14 text-center text-sm text-slate-400 shadow-sm">
                No dishes found. Try a different search.
              </div>
            ) : (
              <VariantGrid
                categoryName=""
                variants={filteredVariants!.map((f) => f.variant)}
                cartItems={items}
                showCategory
                categoryNames={new Map(filteredVariants!.map((f) => [f.variant.id, f.categoryName]))}
                onAdd={handleAddVariant}
                onIncrement={(variantId) => {
                  const cartItem = items.find((i) => i.variantId === variantId);
                  if (cartItem) incrementItem(cartItem.id);
                }}
                onDecrement={(variantId) => {
                  const cartItem = items.find((i) => i.variantId === variantId);
                  if (cartItem) decrementItem(cartItem.id);
                }}
              />
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {categories.map((category) => {
              const visibleVariants = collectVariants(category).filter((node) => node.type === "variant");
              return (
                <section
                  key={category.id}
                  ref={(el) => { if (el) sectionRefs.current.set(category.id, el); }}
                  data-category-id={category.id}
                >
                  <div className="mb-2 px-1">
                    <h2 className="text-lg font-extrabold text-slate-900">{category.name}</h2>
                    {category.description ? (
                      <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{category.description}</p>
                    ) : null}
                  </div>
                  <VariantGrid
                    categoryName={category.name}
                    variants={visibleVariants}
                    cartItems={items}
                    onAdd={handleAddVariant}
                    onIncrement={(variantId) => {
                      const cartItem = items.find((i) => i.variantId === variantId);
                      if (cartItem) incrementItem(cartItem.id);
                    }}
                    onDecrement={(variantId) => {
                      const cartItem = items.find((i) => i.variantId === variantId);
                      if (cartItem) decrementItem(cartItem.id);
                    }}
                  />
                </section>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom bar: Menu button (left) + Cart FAB (right) */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between px-4 pb-6 pt-2 pointer-events-none">
        {/* Menu floater - thumb level, left side */}
        <button
          type="button"
          onClick={() => setCategorySheetOpen(true)}
          className="pointer-events-auto flex items-center gap-2 rounded-full bg-slate-900 px-5 py-3.5 text-white shadow-[0_8px_24px_rgba(0,0,0,0.25)] transition active:scale-95"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>
          <span className="text-sm font-bold">Menu</span>
        </button>

        {/* Cart FAB - right side */}
        {itemCount > 0 ? (
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="pointer-events-auto flex items-center gap-2.5 rounded-full bg-[#c6533f] px-5 py-3.5 text-white shadow-[0_8px_32px_rgba(198,83,63,0.45)] transition active:scale-95"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
            <span className="text-sm font-bold">{itemCount}</span>
            <span className="h-4 w-px bg-white/30" />
            <span className="text-sm font-extrabold">₹{subtotal}</span>
          </button>
        ) : null}
      </div>

      {/* Category bottom sheet */}
      <CategoryMenuSheet
        open={categorySheetOpen}
        categories={categories}
        onSelect={scrollToCategory}
        onClose={() => setCategorySheetOpen(false)}
      />

      <VariantModal
        open={Boolean(activeVariant)}
        variant={activeVariant}
        categoryName={activeCategoryName}
        cartItem={editingItem}
        onClose={() => { setActiveVariantId(null); setEditingCartItemId(null); }}
        onSubmit={(item, existingId) => {
          if (existingId) updateItem(existingId, item); else addItem(item);
          setActiveVariantId(null); setEditingCartItemId(null);
        }}
      />

      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        onCheckout={handleCheckout}
        onEditItem={(itemId) => {
          const item = items.find((entry) => entry.id === itemId);
          if (!item) return;
          setEditingCartItemId(item.id); setActiveVariantId(item.variantId); setCartOpen(false);
        }}
      />

      <OrderTypeModal
        open={orderTypeOpen}
        onClose={() => setOrderTypeOpen(false)}
        onConfirm={handleOrderTypeConfirm}
      />
    </main>
  );
}
