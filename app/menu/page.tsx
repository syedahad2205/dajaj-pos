"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import CartDrawer from "@/components/cart/CartDrawer";
import { useCart } from "@/components/cart/CartProvider";
import VariantGrid from "@/components/menu/VariantGrid";
import VariantModal, { getInstantAddModifiers } from "@/components/menu/VariantModal";
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

export default function MenuPage() {
  const { items, itemCount, subtotal, addItem, updateItem, incrementItem, decrementItem } = useCart();
  const [menuTree, setMenuTree] = useState<MenuTreeNode[]>([]);
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState<Set<string>>(new Set());
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null);
  const [editingCartItemId, setEditingCartItemId] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [orderTypeOpen, setOrderTypeOpen] = useState(false);
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

  const categories = useMemo(() => menuTree.filter((node) => node.type === "category"), [menuTree]);

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

  const toggleCategory = (id: string) => {
    setCollapsedCategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAddVariant = (variant: MenuTreeNode) => {
    setEditingCartItemId(null);
    const instantAddModifiers = getInstantAddModifiers(variant);
    if (instantAddModifiers) {
      addItem({
        categoryName: categories.find((category) => collectVariants(category).some((entry) => entry.id === variant.id))?.name ?? "",
        variantId: variant.id,
        variantName: variant.name,
        basePrice: variant.price,
        modifiers: instantAddModifiers ?? [],
        quantity: 1,
        totalPrice: variant.price + (instantAddModifiers?.reduce((sum, modifier) => sum + modifier.price, 0) ?? 0),
        imageUrl: variant.imageUrl,
        description: variant.description,
      });
      setCartOpen(true);
      return;
    }
    setActiveVariantId(variant.id);
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

  return (
    <main className="min-h-screen w-full overflow-x-hidden bg-[#faf6f1] text-slate-900">
      {/* Warm gradient header strip */}
      <div className="bg-[#faf6f1] px-4 pb-6 pt-8 text-center">
        <Image src="/logo.png" alt="Dajaj logo" width={56} height={56} className="mx-auto mb-2 h-auto w-auto" />
        <h1 className="text-3xl font-black tracking-tight text-slate-900">Our Menu</h1>
        <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-slate-400">
          Tap a category, customise your dish and build your perfect order.
        </p>
      </div>

      {/* Content pulls up over the header */}
      <div className="mx-auto w-full max-w-[600px] px-4 pb-36">
        {/* Cart summary pill */}
        {itemCount > 0 && (
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="mb-4 flex w-full items-center justify-between rounded-2xl bg-white px-5 py-4 shadow-[0_2px_16px_rgba(0,0,0,0.06)] transition active:scale-[0.98]"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-600 text-sm font-bold text-white">
                {itemCount}
              </span>
              <span className="text-sm font-bold text-slate-900">
                {itemCount === 1 ? "item" : "items"} in cart
              </span>
            </div>
            <span className="text-lg font-extrabold text-slate-900">₹{subtotal}</span>
          </button>
        )}

        {status ? (
          <div className="rounded-2xl bg-white px-6 py-14 text-center text-sm font-medium text-slate-400 shadow-sm">
            {status}
          </div>
        ) : (
          <div className="space-y-3">
            {categories.map((category) => {
              const isCollapsed = collapsedCategoryIds.has(category.id);
              const visibleVariants = collectVariants(category).filter((node) => node.type === "variant");
              return (
                <section key={category.id} className="overflow-hidden rounded-2xl bg-white shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
                  <button
                    type="button"
                    onClick={() => toggleCategory(category.id)}
                    className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <h2 className="text-lg font-extrabold text-slate-900">{category.name}</h2>
                      {category.description ? (
                        <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{category.description}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-600">
                        {visibleVariants.length}
                      </span>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={`text-slate-400 transition-transform duration-200 ${isCollapsed ? "" : "rotate-180"}`}
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </div>
                  </button>

                  {!isCollapsed && (
                    <div className="border-t border-slate-100 px-4 py-3">
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
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>

      {/* Cart FAB */}
      {itemCount > 0 && (
        <button
          type="button"
          onClick={() => setCartOpen(true)}
          className="fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full bg-[#c6533f] px-6 py-4 text-white shadow-[0_8px_32px_rgba(198,83,63,0.45)] transition active:scale-95"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
          <span className="text-sm font-bold">View Cart</span>
          <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-bold">{itemCount}</span>
        </button>
      )}

      <VariantModal
        open={Boolean(activeVariant)}
        variant={activeVariant}
        categoryName={activeCategoryName}
        cartItem={editingItem}
        onClose={() => { setActiveVariantId(null); setEditingCartItemId(null); }}
        onSubmit={(item, existingId) => {
          if (existingId) updateItem(existingId, item); else addItem(item);
          setActiveVariantId(null); setEditingCartItemId(null); setCartOpen(true);
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
