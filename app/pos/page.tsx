'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { clearAdminBypassSession } from '@/lib/devAuth';
import { auth } from '@/lib/firebase';
import { createBill, type BillItem } from '@/lib/firestore';
import { requireAdmin } from '@/lib/roleGuard';
import type { MenuTreeNode } from '@/lib/menu-builder';
import { getAvailableMenuTree } from '@/services/menuService';
import VariantModal, { getInstantAddModifiers } from '@/components/menu/VariantModal';

type PosModifier = {
  id: string;
  name: string;
  price: number;
  groupName: string;
};

type PosCartItem = {
  id: string;
  sku: string;
  name: string;
  variantLabel: string;
  qty: number;
  basePrice: number;
  modifiers: PosModifier[];
  itemTotal: number;
  variantId: string;
};

const SOFT_BLACK = '#1a1a1a';
const SOFT_WHITE = '#fafafa';
const SOFT_GRAY = '#e8e8e8';
const BRAND_RED = '#d43f2f';

function collectVariants(node: MenuTreeNode): MenuTreeNode[] {
  const variants: MenuTreeNode[] = [];

  for (const child of node.children) {
    if (child.type === 'variant') {
      variants.push(child);
    }

    variants.push(...collectVariants(child));
  }

  return variants;
}

function buildSku(variant: MenuTreeNode, modifiers: PosModifier[]) {
  const modifierPart = modifiers
    .map((modifier) => modifier.id)
    .sort()
    .join('-');

  return `${variant.id}${modifierPart ? `-${modifierPart}` : ''}`;
}

function getPerUnitTotal(basePrice: number, modifiers: PosModifier[]) {
  return basePrice + modifiers.reduce((sum, modifier) => sum + modifier.price, 0);
}

function getCartSignature(variantId: string, modifiers: PosModifier[]) {
  return `${variantId}:${JSON.stringify(modifiers.map((modifier) => modifier.id).sort())}`;
}

export default function POSPage() {
  const { authenticated, loading, role } = requireAdmin();
  const router = useRouter();
  const [menuTree, setMenuTree] = useState<MenuTreeNode[]>([]);
  const [status, setStatus] = useState('Loading menu...');
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);
  const [cart, setCart] = useState<PosCartItem[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [customerMobile, setCustomerMobile] = useState('');
  const [activeVariant, setActiveVariant] = useState<MenuTreeNode | null>(null);
  const [activeCategoryName, setActiveCategoryName] = useState('');
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!authenticated || role !== 'admin') {
      return;
    }

    let cancelled = false;
    void getAvailableMenuTree()
      .then(({ tree }) => {
        if (cancelled) {
          return;
        }

        setMenuTree(tree);
        setExpandedCategoryId((current) => current ?? tree.find((node) => node.type === 'category')?.id ?? null);
        setStatus(tree.length === 0 ? 'No menu is available right now.' : '');
      })
      .catch((error: Error) => {
        if (cancelled) {
          return;
        }

        setStatus(error.message || 'Failed to load menu.');
      });

    return () => {
      cancelled = true;
    };
  }, [authenticated, role]);

  const categories = useMemo(() => menuTree.filter((node) => node.type === 'category'), [menuTree]);

  const addVariantToCart = (variant: MenuTreeNode, categoryName: string, modifiers: PosModifier[], qty = 1) => {
    const perUnit = getPerUnitTotal(variant.price, modifiers);
    const signature = getCartSignature(variant.id, modifiers);

    setCart((current) => {
      const existing = current.find((item) => getCartSignature(item.variantId, item.modifiers) === signature);
      if (!existing) {
        return [
          ...current,
          {
            id: crypto.randomUUID(),
            sku: buildSku(variant, modifiers),
            name: categoryName,
            variantLabel: variant.name,
            qty,
            basePrice: variant.price,
            modifiers,
            itemTotal: perUnit * qty,
            variantId: variant.id,
          },
        ];
      }

      return current.map((item) =>
        item.id === existing.id
          ? {
              ...item,
              qty: item.qty + qty,
              itemTotal: perUnit * (item.qty + qty),
            }
          : item,
      );
    });
  };

  const subtotal = cart.reduce((sum, item) => sum + item.itemTotal, 0);
  const grandTotal = subtotal;
  const cgst = grandTotal * 0.025;
  const sgst = grandTotal * 0.025;

  const handleGenerateBill = async () => {
    if (!customerName.trim()) {
      alert('Please enter customer name');
      return;
    }

    if (cart.length === 0) {
      alert('Please add items to cart');
      return;
    }

    setGenerating(true);

    try {
      const billItems: BillItem[] = cart.map((item) => ({
        sku: item.sku,
        name: item.name,
        variant: item.variantLabel,
        qty: item.qty,
        basePrice: item.basePrice,
        addons: item.modifiers.map((modifier) => ({
          name: `${modifier.groupName}: ${modifier.name}`,
          price: modifier.price,
        })),
        itemTotal: item.itemTotal,
      }));

      const { billNo, publicToken } = await createBill({
        customer: {
          name: customerName.trim(),
          ...(customerMobile.trim() && { mobile: customerMobile.trim() }),
        },
        items: billItems,
        subtotal,
        cgst,
        sgst,
        grandTotal,
        paymentMode: 'Cash',
      });

      router.push(`/bill/${billNo}?token=${encodeURIComponent(publicToken)}`);
    } catch (error) {
      console.error('Error creating bill:', error);
      alert('Failed to generate bill. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const handleLogout = async () => {
    clearAdminBypassSession();
    await signOut(auth);
    router.push('/admin/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-xl" style={{ color: SOFT_BLACK }}>Loading...</div>
      </div>
    );
  }

  if (!authenticated || role !== 'admin') {
    return null;
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="border-b" style={{ borderColor: SOFT_GRAY }}>
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold" style={{ color: SOFT_BLACK }}>DAJAJ POS</h1>
          <div className="flex gap-3">
            <button
              onClick={() => router.push('/bills')}
              className="px-4 py-2 rounded-md transition-colors"
              style={{ backgroundColor: SOFT_GRAY, color: SOFT_BLACK, border: `1px solid ${SOFT_GRAY}` }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e0e0e0'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = SOFT_GRAY}
            >
              Bill History
            </button>
            <button
              onClick={handleLogout}
              className="px-4 py-2 rounded-md transition-colors"
              style={{ backgroundColor: SOFT_BLACK, color: SOFT_WHITE }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#2a2a2a'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = SOFT_BLACK}
            >
              Logout
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="bg-white rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-6" style={{ color: SOFT_BLACK }}>Menu</h2>

            {status ? (
              <div className="rounded-lg border px-4 py-10 text-center text-sm" style={{ borderColor: SOFT_GRAY, color: `${SOFT_BLACK}99` }}>
                {status}
              </div>
            ) : (
              <div className="space-y-4">
                {categories.map((category) => {
                  const isExpanded = expandedCategoryId === category.id;
                  const variants = collectVariants(category);

                  return (
                    <section key={category.id} className="rounded-2xl border" style={{ borderColor: SOFT_GRAY }}>
                      <button
                        type="button"
                        onClick={() => setExpandedCategoryId((current) => (current === category.id ? null : category.id))}
                        className="flex w-full items-center justify-between px-5 py-4 text-left"
                      >
                        <div>
                          <h3 className="text-lg font-semibold" style={{ color: SOFT_BLACK }}>
                            {isExpanded ? '▼' : '►'} {category.name}
                          </h3>
                          <p className="text-sm" style={{ color: `${SOFT_BLACK}99` }}>
                            {variants.length} {variants.length === 1 ? 'item' : 'items'}
                          </p>
                        </div>
                      </button>

                      {isExpanded ? (
                        <div className="border-t px-5 py-5" style={{ borderColor: SOFT_GRAY }}>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {variants.map((variant) => (
                              <div key={variant.id} className="rounded-2xl border p-4" style={{ borderColor: SOFT_GRAY, backgroundColor: SOFT_WHITE }}>
                                <div className="flex items-start justify-between gap-4">
                                  <div>
                                    <p className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: BRAND_RED }}>
                                      {category.name}
                                    </p>
                                    <h4 className="text-lg font-bold" style={{ color: SOFT_BLACK }}>{variant.name}</h4>
                                    {variant.description ? (
                                      <p className="mt-1 text-sm" style={{ color: `${SOFT_BLACK}99` }}>{variant.description}</p>
                                    ) : null}
                                  </div>
                                  <span className="text-lg font-bold" style={{ color: SOFT_BLACK }}>₹{variant.price}</span>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => {
                                    const instantModifiers = getInstantAddModifiers(variant);
                                    if (instantModifiers) {
                                      addVariantToCart(
                                        variant,
                                        category.name,
                                        instantModifiers.map((modifier) => ({
                                          id: modifier.id,
                                          name: modifier.name,
                                          price: modifier.price,
                                          groupName: modifier.groupName,
                                        })),
                                      );
                                      return;
                                    }

                                    setActiveVariant(variant);
                                    setActiveCategoryName(category.name);
                                  }}
                                  className="mt-4 w-full rounded-xl px-4 py-3 text-sm font-semibold text-white"
                                  style={{ backgroundColor: SOFT_BLACK }}
                                >
                                  Add
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="bg-white border rounded-lg p-6 space-y-4 sticky top-4" style={{ borderColor: SOFT_GRAY }}>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: SOFT_BLACK }}>
                Customer Name *
              </label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Enter customer name"
                className="w-full px-3 py-3 rounded-md focus:outline-none focus:ring-2 transition-colors"
                style={{ borderColor: SOFT_GRAY, color: SOFT_BLACK, borderWidth: '1px' }}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: SOFT_BLACK }}>
                Customer Mobile
              </label>
              <input
                type="tel"
                value={customerMobile}
                onChange={(e) => setCustomerMobile(e.target.value)}
                placeholder="9XXXXXXXXX (Optional)"
                className="w-full px-3 py-3 rounded-md focus:outline-none focus:ring-2 transition-colors"
                style={{ borderColor: SOFT_GRAY, color: SOFT_BLACK, borderWidth: '1px' }}
              />
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-2" style={{ color: SOFT_BLACK }}>Items</h3>
              <div className="space-y-2">
                {cart.length === 0 ? (
                  <p className="text-sm" style={{ color: `${SOFT_BLACK}99` }}>No items added</p>
                ) : (
                  cart.map((item) => (
                    <div key={item.id} className="p-3 rounded-lg border" style={{ backgroundColor: SOFT_WHITE, borderColor: SOFT_GRAY }}>
                      <div className="flex justify-between items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm" style={{ color: SOFT_BLACK }}>{item.name}</div>
                          <div className="text-xs" style={{ color: `${SOFT_BLACK}99` }}>{item.variantLabel}</div>
                          {item.modifiers.length > 0 ? (
                            <div className="text-xs mt-1" style={{ color: `${SOFT_BLACK}80` }}>
                              + {item.modifiers.map((modifier) => `${modifier.groupName}: ${modifier.name}`).join(', ')}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <div className="font-medium text-sm" style={{ color: SOFT_BLACK }}>₹{item.itemTotal.toFixed(2)}</div>
                          <div className="flex items-center gap-2 rounded-lg border bg-white overflow-hidden" style={{ borderColor: SOFT_GRAY }}>
                            <button
                              onClick={() =>
                                setCart((current) =>
                                  current
                                    .map((entry) =>
                                      entry.id === item.id
                                        ? {
                                            ...entry,
                                            qty: entry.qty - 1,
                                            itemTotal: getPerUnitTotal(entry.basePrice, entry.modifiers) * (entry.qty - 1),
                                          }
                                        : entry,
                                    )
                                    .filter((entry) => entry.qty > 0),
                                )
                              }
                              className="flex items-center justify-center font-bold text-lg"
                              style={{ minHeight: '36px', minWidth: '36px', color: SOFT_BLACK }}
                            >
                              –
                            </button>
                            <div className="flex items-center justify-center font-semibold text-sm min-w-[32px]" style={{ color: SOFT_BLACK }}>
                              {item.qty}
                            </div>
                            <button
                              onClick={() =>
                                setCart((current) =>
                                  current.map((entry) =>
                                    entry.id === item.id
                                      ? {
                                          ...entry,
                                          qty: entry.qty + 1,
                                          itemTotal: getPerUnitTotal(entry.basePrice, entry.modifiers) * (entry.qty + 1),
                                        }
                                      : entry,
                                  ),
                                )
                              }
                              className="flex items-center justify-center font-bold text-lg"
                              style={{ minHeight: '36px', minWidth: '36px', color: SOFT_BLACK }}
                            >
                              +
                            </button>
                          </div>
                          <button
                            onClick={() => setCart((current) => current.filter((entry) => entry.id !== item.id))}
                            className="text-xs px-2 py-1 rounded transition-colors font-medium"
                            style={{ color: BRAND_RED, border: `1px solid ${BRAND_RED}`, backgroundColor: 'transparent' }}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="border-t pt-4 space-y-2" style={{ borderColor: SOFT_GRAY }}>
              <div className="flex justify-between text-sm" style={{ color: SOFT_BLACK }}>
                <span>Subtotal:</span>
                <span>₹{subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm" style={{ color: `${SOFT_BLACK}99` }}>
                <span>CGST (2.5%):</span>
                <span>₹{cgst.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm" style={{ color: `${SOFT_BLACK}99` }}>
                <span>SGST (2.5%):</span>
                <span>₹{sgst.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold text-lg border-t pt-2" style={{ color: SOFT_BLACK, borderColor: SOFT_GRAY }}>
                <span>Grand Total:</span>
                <span>₹{grandTotal.toFixed(2)}</span>
              </div>
            </div>

            <button
              onClick={handleGenerateBill}
              disabled={generating || cart.length === 0 || !customerName.trim()}
              className="w-full py-4 px-4 rounded-md font-medium transition-colors"
              style={{ backgroundColor: cart.length === 0 || !customerName.trim() ? SOFT_GRAY : SOFT_BLACK, color: SOFT_WHITE }}
            >
              {generating ? 'Generating...' : 'Generate Bill'}
            </button>
          </div>
        </div>
      </div>

      <VariantModal
        open={Boolean(activeVariant)}
        variant={activeVariant}
        categoryName={activeCategoryName}
        onClose={() => setActiveVariant(null)}
        onSubmit={(item) => {
          const variant = activeVariant;
          if (!variant) {
            return;
          }

          addVariantToCart(
            variant,
            activeCategoryName,
            item.modifiers.map((modifier) => ({
              id: modifier.id,
              name: modifier.name,
              price: modifier.price,
              groupName: modifier.groupName,
            })),
            item.quantity,
          );
          setActiveVariant(null);
        }}
      />
    </div>
  );
}
