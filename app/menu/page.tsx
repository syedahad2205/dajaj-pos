"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AddressSelector from "@/components/address/AddressSelector";
import { useAddresses } from "@/components/address/AddressProvider";
import CartDrawer from "@/components/cart/CartDrawer";
import { useCart } from "@/components/cart/CartProvider";
import VariantGrid from "@/components/menu/VariantGrid";
import VariantModal, { getInstantAddModifiers } from "@/components/menu/VariantModal";
import MenuPageTracker from "@/components/MenuPageTracker";
import type { MenuTreeNode } from "@/lib/menu-builder";
import { requireCustomer } from "@/lib/roleGuard";
import { getAvailableMenuTree } from "@/services/menuService";
import CustomerNavBar from "@/components/CustomerNavBar";

function collectVariants(node: MenuTreeNode): MenuTreeNode[] {
  const variants: MenuTreeNode[] = [];

  for (const child of node.children) {
    if (child.type === "variant") {
      variants.push(child);
    }

    variants.push(...collectVariants(child));
  }

  return variants;
}

function MenuExperience() {
  const router = useRouter();
  const { authenticated, loading, role } = requireCustomer();
  const { items, itemCount, subtotal, addItem, updateItem } = useCart();
  const { selectedAddress } = useAddresses();
  const [menuTree, setMenuTree] = useState<MenuTreeNode[]>([]);
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null);
  const [editingCartItemId, setEditingCartItemId] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [addressSelectorOpen, setAddressSelectorOpen] = useState(false);
  const [status, setStatus] = useState("Loading menu...");

  useEffect(() => {
    if (!authenticated) {
      return;
    }

    let cancelled = false;
    void getAvailableMenuTree()
      .then(({ tree }) => {
        if (cancelled) {
          return;
        }

        setMenuTree(tree);
        setStatus(tree.length === 0 ? "No menu is available right now." : "");
      })
      .catch((error: Error) => {
        if (cancelled) {
          return;
        }

        setStatus(error.message || "Failed to load menu.");
      });

    return () => {
      cancelled = true;
    };
  }, [authenticated]);

  const categories = useMemo(() => menuTree.filter((node) => node.type === "category"), [menuTree]);

  const variantLookup = useMemo(() => {
    const map = new Map<string, MenuTreeNode>();

    const walk = (nodes: MenuTreeNode[]) => {
      nodes.forEach((node) => {
        map.set(node.id, node);
        walk(node.children);
      });
    };

    walk(menuTree);
    return map;
  }, [menuTree]);

  const activeVariant = activeVariantId ? variantLookup.get(activeVariantId) ?? null : null;
  const editingItem = editingCartItemId ? items.find((item) => item.id === editingCartItemId) ?? null : null;
  const activeCategoryName = editingItem?.categoryName ?? categories.find((category) => collectVariants(category).some((variant) => variant.id === activeVariantId))?.name ?? "";

  if (loading) {
    return (
      <main className="min-h-screen w-full overflow-x-hidden bg-[linear-gradient(180deg,#fff8ed_0%,#ffe7cf_100%)] py-4 text-slate-900">
        <div className="mx-auto w-full max-w-[1200px] px-4">
          <div className="rounded-[28px] border border-orange-200 bg-white px-6 py-14 text-center text-sm font-medium text-slate-600">
            Checking your session...
          </div>
        </div>
      </main>
    );
  }

  if (!authenticated || role !== "customer") {
    return null;
  }

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

  return (
    <main className="min-h-screen w-full overflow-x-hidden bg-[linear-gradient(180deg,#fff8ed_0%,#ffe7cf_100%)] py-4 text-slate-900 md:pt-[72px]">
      <MenuPageTracker />

      <div className="mx-auto w-full max-w-[1200px] px-4 pb-36 md:pb-24">
        <header className="mb-5 rounded-[28px] border border-orange-200 bg-white/85 px-5 py-5 shadow-[0_20px_60px_rgba(194,65,12,0.12)] backdrop-blur">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-orange-600">Dajaj</p>
          <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-3xl font-black">Customer Menu</h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Choose a category, customize each dish if needed, and build your order with ease.
              </p>
            </div>
            <div className="rounded-2xl bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-700">
              {itemCount} items • ₹{subtotal}
            </div>
          </div>
          <div className="mt-4 flex items-start justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Delivering to</p>
              {selectedAddress ? (
                <>
                  <p className="mt-1 text-sm font-semibold text-slate-900">📍 {selectedAddress.label}</p>
                  <p className="mt-1 text-sm text-slate-500">{selectedAddress.addressLine1}</p>
                </>
              ) : (
                <p className="mt-1 text-sm font-semibold text-slate-900">Choose a delivery address</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setAddressSelectorOpen(true)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
            >
              Change
            </button>
          </div>
        </header>

        <section className="space-y-4">
          {status ? (
            <div className="rounded-[28px] border border-orange-200 bg-white px-6 py-14 text-center text-sm font-medium text-slate-600">
              {status}
            </div>
          ) : categories.length > 0 ? (
            categories.map((category) => {
              const isExpanded = expandedCategoryId === category.id;
              const visibleVariants = collectVariants(category).filter((node) => node.type === "variant");

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
                        {visibleVariants.length} {visibleVariants.length === 1 ? "item" : "items"}
                      </p>
                      {category.description ? (
                        <p className="mt-2 text-sm leading-6 text-slate-600">{category.description}</p>
                      ) : null}
                    </div>
                  </button>

                  {isExpanded ? (
                    <div className="border-t border-orange-100 px-5 py-5">
                      <VariantGrid
                        categoryName={category.name}
                        variants={visibleVariants}
                        onAdd={handleAddVariant}
                      />
                    </div>
                  ) : null}
                </section>
              );
            })
          ) : (
            <div className="rounded-[28px] border border-slate-200 bg-white px-6 py-14 text-center text-sm text-slate-500">
              No categories available.
            </div>
          )}
        </section>
      </div>

      <button
        type="button"
        onClick={() => setCartOpen(true)}
        className="fixed bottom-20 right-4 z-30 rounded-full bg-slate-900 px-5 py-4 text-sm font-semibold text-white shadow-[0_16px_32px_rgba(15,23,42,0.28)] md:bottom-4"
      >
        Cart ({itemCount})
      </button>

      <VariantModal
        open={Boolean(activeVariant)}
        variant={activeVariant}
        categoryName={activeCategoryName}
        cartItem={editingItem}
        onClose={() => {
          setActiveVariantId(null);
          setEditingCartItemId(null);
        }}
        onSubmit={(item, existingId) => {
          if (existingId) {
            updateItem(existingId, item);
          } else {
            addItem(item);
          }

          setActiveVariantId(null);
          setEditingCartItemId(null);
          setCartOpen(true);
        }}
      />

      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        onCheckout={() => {
          setCartOpen(false);
          router.push("/checkout");
        }}
        onEditItem={(itemId) => {
          const item = items.find((entry) => entry.id === itemId);
          if (!item) {
            return;
          }

          setEditingCartItemId(item.id);
          setActiveVariantId(item.variantId);
          setCartOpen(false);
        }}
      />
      <AddressSelector open={addressSelectorOpen} onClose={() => setAddressSelectorOpen(false)} />
      <CustomerNavBar />
    </main>
  );
}

export default function MenuPage() {
  return <MenuExperience />;
}
