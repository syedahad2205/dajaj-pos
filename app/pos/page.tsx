'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { clearAdminBypassSession } from '@/lib/devAuth';
import { auth } from '@/lib/firebase';
import {
  createBill,
  createPosOpenOrder,
  deletePosOpenOrder,
  getNextDailyOrderLabel,
  markPosOrderBilled,
  reopenBillAsOrder,
  subscribeToPosOpenOrders,
  subscribeToTodaysBills,
  updatePosOpenOrder,
  getPosStaffProfileByEmail,
  type Bill,
  type BillItem,
  type PosCartItem,
  type PosModifier,
  type PosOpenOrder,
} from '@/lib/firestore';
import { requirePosStaff } from '@/lib/roleGuard';
import type { MenuTreeNode } from '@/lib/menu-builder';
import { buildMenuTree, getMenuNodes } from '@/lib/menu-builder';
import VariantModal, { getInstantAddModifiers } from '@/components/menu/VariantModal';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Renders DDMMYY in muted + 0001 in bold orange, or plain text */
function OrderLabel({ name, className = '' }: { name: string; className?: string }) {
  if (/^\d{10}$/.test(name)) {
    return (
      <span className={`font-mono ${className}`}>
        <span className="text-neutral-400 text-xs">{name.slice(0, 6)}</span>
        <span className="text-orange-600 font-extrabold">#{name.slice(6)}</span>
      </span>
    );
  }
  return <span className={className}>{name || 'Guest'}</span>;
}

function collectVariants(node: MenuTreeNode): MenuTreeNode[] {
  const out: MenuTreeNode[] = [];
  for (const child of node.children) {
    if (child.type === 'variant') out.push(child);
    out.push(...collectVariants(child));
  }
  return out;
}

function buildSku(variant: MenuTreeNode, modifiers: PosModifier[]) {
  const modPart = [...modifiers].sort((a, b) => a.id.localeCompare(b.id)).map((m) => m.id).join('-');
  return `${variant.id}${modPart ? `-${modPart}` : ''}`;
}

function getPerUnitTotal(basePrice: number, modifiers: PosModifier[]) {
  return basePrice + modifiers.reduce((s, m) => s + m.price, 0);
}

function getCartSignature(variantId: string, modifiers: PosModifier[]) {
  return `${variantId}:${[...modifiers].sort((a, b) => a.id.localeCompare(b.id)).map((m) => m.id).join(',')}`;
}

function calcTotals(items: PosCartItem[]) {
  const grandTotal = items.reduce((s, i) => s + i.itemTotal, 0);
  return { subtotal: grandTotal, cgst: 0, sgst: 0, grandTotal };
}

function timeAgo(ts: unknown): string {
  if (!ts || typeof ts !== 'object' || !('toDate' in ts) || typeof (ts as { toDate: unknown }).toDate !== 'function') return '';
  const diff = Math.floor((Date.now() - (ts as { toDate: () => Date }).toDate().getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// ─── component ─────────────────────────────────────────────────────────────────

type PaymentMode = 'Cash' | 'Card' | 'UPI';

export default function POSPage() {
  const { authenticated, loading, role } = requirePosStaff();
  const router = useRouter();

  // Menu
  const [menuTree, setMenuTree] = useState<MenuTreeNode[]>([]);
  const [menuStatus, setMenuStatus] = useState('Loading menu...');
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeVariant, setActiveVariant] = useState<MenuTreeNode | null>(null);
  const [activeCategoryName, setActiveCategoryName] = useState('');

  // Open orders (from Firestore)
  const [openOrders, setOpenOrders] = useState<PosOpenOrder[]>([]);

  // Today's billed orders
  const [todayBills, setTodayBills] = useState<(Bill & { docId: string })[]>([]);

  // Active order being edited
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [localItems, setLocalItems] = useState<PosCartItem[]>([]);
  const [localLabel, setLocalLabel] = useState('');

  // Bill confirm modal
  type BillConfirm = { orderId: string; label: string; items: PosCartItem[]; grandTotal: number; paymentMode: PaymentMode; cashCollected: string };
  const [billConfirm, setBillConfirm] = useState<BillConfirm | null>(null);
  const [lastBill, setLastBill] = useState<{ billNo: string; publicToken: string } | null>(null);

  // UI state
  const [billing, setBilling] = useState(false);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [canManageInventory, setCanManageInventory] = useState(false);
  const [showOrdersPanel, setShowOrdersPanel] = useState(true);
  const [mobileTab, setMobileTab] = useState<'orders' | 'menu' | 'cart'>('menu');

  // Debounce ref to sync localItems → Firestore
  const syncTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Menu load ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authenticated || (role !== 'admin' && role !== 'pos')) return;
    let cancelled = false;
    getMenuNodes().then((nodes) => {
      if (cancelled) return;
      const tree = buildMenuTree(nodes);
      setMenuTree(tree);
      setExpandedCategoryId(tree.find((n) => n.type === 'category')?.id ?? null);
      setMenuStatus(tree.length === 0 ? 'No menu available.' : '');
    }).catch((e: Error) => {
      if (!cancelled) setMenuStatus(e.message || 'Failed to load menu.');
    });
    return () => { cancelled = true; };
  }, [authenticated, role]);

  useEffect(() => {
    if (!authenticated || loading) return;
    if (role === 'admin') {
      setCanManageInventory(true);
      return;
    }

    const email = auth.currentUser?.email;
    if (!email) {
      setCanManageInventory(false);
      return;
    }

    void getPosStaffProfileByEmail(email)
      .then((profile) => setCanManageInventory(Boolean(profile?.canManageInventory)))
      .catch(() => setCanManageInventory(false));
  }, [authenticated, loading, role]);

  // ── Subscribe to open orders ─────────────────────────────────────────────────
  useEffect(() => {
    if (!authenticated || (role !== 'admin' && role !== 'pos')) return;
    const unsub = subscribeToPosOpenOrders(setOpenOrders);
    return unsub;
  }, [authenticated, role]);

  // ── Subscribe to today's bills ───────────────────────────────────────────────
  useEffect(() => {
    if (!authenticated || (role !== 'admin' && role !== 'pos')) return;
    const unsub = subscribeToTodaysBills(setTodayBills);
    return unsub;
  }, [authenticated, role]);

  // ── When open orders list changes, keep localItems in sync if active order was updated externally ──
  useEffect(() => {
    if (!activeOrderId) return;
    const order = openOrders.find((o) => o.id === activeOrderId);
    if (!order) {
      // Order was deleted (billed from another tab?) — deselect
      setActiveOrderId(null);
      setLocalItems([]);
      setLocalLabel('');
    }
  }, [openOrders, activeOrderId]);

  // ── Sync local state → Firestore (debounced 600ms) ──────────────────────────
  const scheduleSyncToFirestore = useCallback((orderId: string, label: string, items: PosCartItem[]) => {
    if (syncTimeout.current) clearTimeout(syncTimeout.current);
    syncTimeout.current = setTimeout(() => {
      void updatePosOpenOrder(orderId, label, items);
    }, 600);
  }, []);

  // Flush immediately (before switching orders or billing)
  const flushSync = useCallback(async () => {
    if (syncTimeout.current) clearTimeout(syncTimeout.current);
    if (activeOrderId) {
      await updatePosOpenOrder(activeOrderId, localLabel, localItems);
    }
  }, [activeOrderId, localLabel, localItems]);

  // ── Select order ─────────────────────────────────────────────────────────────
  const selectOrder = useCallback(async (order: PosOpenOrder) => {
    if (activeOrderId === order.id) return;
    await flushSync();
    setActiveOrderId(order.id);
    setLocalItems(order.items);
    setLocalLabel(order.label);
    setMobileTab('menu');
  }, [activeOrderId, flushSync]);

  // ── Reopen a billed order for editing ────────────────────────────────────────
  const handleReopenBill = async (bill: Bill & { docId: string }) => {
    await flushSync();
    const newId = await reopenBillAsOrder(bill);
    // The new order will appear via the subscription — select it
    const waitForOrder = () => {
      setActiveOrderId(newId);
      setLocalItems(
        bill.items.map((bi, idx) => ({
          id: `reopened-${idx}-${Date.now()}`,
          sku: bi.sku,
          name: bi.name,
          variantLabel: bi.variant,
          qty: bi.qty,
          basePrice: bi.basePrice,
          modifiers: bi.addons.map((a, ai) => {
            const parts = a.name.split(': ');
            return { id: `mod-${idx}-${ai}`, groupName: parts[0] || '', name: parts[1] || a.name, price: a.price };
          }),
          itemTotal: bi.itemTotal,
          variantId: '',
        }))
      );
      setLocalLabel(bill.customer.name || bill.billNo);
      setMobileTab('menu');
    };
    waitForOrder();
  };

  // ── New order ────────────────────────────────────────────────────────────────
  const handleNewOrder = async () => {
    await flushSync();
    setCreatingOrder(true);
    try {
      const label = await getNextDailyOrderLabel();
      const id = await createPosOpenOrder(label, auth.currentUser?.email ?? undefined);
      setActiveOrderId(id);
      setLocalItems([]);
      setLocalLabel(label);
      setMobileTab('menu');
    } finally {
      setCreatingOrder(false);
    }
  };

  // ── Add item to active order ─────────────────────────────────────────────────
  const addToActiveOrder = useCallback((variant: MenuTreeNode, categoryName: string, modifiers: PosModifier[], qty = 1) => {
    if (!activeOrderId) return;
    const perUnit = getPerUnitTotal(variant.price, modifiers);
    const sig = getCartSignature(variant.id, modifiers);

    setLocalItems((prev) => {
      let updated: PosCartItem[];
      const existing = prev.find((item) => getCartSignature(item.variantId, item.modifiers) === sig);
      if (!existing) {
        updated = [...prev, {
          id: crypto.randomUUID(),
          sku: buildSku(variant, modifiers),
          name: categoryName,
          variantLabel: variant.name,
          qty,
          basePrice: variant.price,
          modifiers,
          itemTotal: perUnit * qty,
          variantId: variant.id,
        }];
      } else {
        updated = prev.map((item) =>
          item.id === existing.id
            ? { ...item, qty: item.qty + qty, itemTotal: perUnit * (item.qty + qty) }
            : item
        );
      }
      scheduleSyncToFirestore(activeOrderId, localLabel, updated);
      return updated;
    });
  }, [activeOrderId, localLabel, scheduleSyncToFirestore]);

  // ── Update qty ────────────────────────────────────────────────────────────────
  const updateQty = useCallback((itemId: string, delta: number) => {
    if (!activeOrderId) return;
    setLocalItems((prev) => {
      const updated = prev.flatMap((item) => {
        if (item.id !== itemId) return [item];
        const newQty = item.qty + delta;
        if (newQty <= 0) return [];
        const perUnit = getPerUnitTotal(item.basePrice, item.modifiers);
        return [{ ...item, qty: newQty, itemTotal: perUnit * newQty }];
      });
      scheduleSyncToFirestore(activeOrderId, localLabel, updated);
      return updated;
    });
  }, [activeOrderId, localLabel, scheduleSyncToFirestore]);

  // ── Update label ──────────────────────────────────────────────────────────────
  const updateLabel = useCallback((val: string) => {
    setLocalLabel(val);
    if (activeOrderId) scheduleSyncToFirestore(activeOrderId, val, localItems);
  }, [activeOrderId, localItems, scheduleSyncToFirestore]);

  // ── Open bill confirm modal ──────────────────────────────────────────────────
  const handleBill = async (orderId?: string) => {
    const targetId = orderId ?? activeOrderId;
    if (!targetId) return;

    let items = localItems;
    let label = localLabel;

    if (orderId && orderId !== activeOrderId) {
      const order = openOrders.find((o) => o.id === orderId);
      if (!order) return;
      items = order.items;
      label = order.label;
    } else {
      await flushSync();
    }

    if (items.length === 0) { alert('No items in this order.'); return; }
    if (!label.trim()) { alert('Please enter a customer name.'); return; }

    const { grandTotal } = calcTotals(items);
    setBillConfirm({ orderId: targetId, label, items, grandTotal, paymentMode: 'Cash', cashCollected: '' });
  };

  // ── Execute bill after modal confirm ─────────────────────────────────────────
  const confirmBill = async () => {
    if (!billConfirm) return;
    const { orderId: targetId, label, items, paymentMode: chosenMode, cashCollected } = billConfirm;
    setBilling(true);
    try {
      const { subtotal, cgst, sgst, grandTotal } = calcTotals(items);
      const billItems: BillItem[] = items.map((item) => ({
        sku: item.sku,
        name: item.name,
        variant: item.variantLabel,
        qty: item.qty,
        basePrice: item.basePrice,
        addons: item.modifiers.map((m) => ({ name: `${m.groupName}: ${m.name}`, price: m.price })),
        itemTotal: item.itemTotal,
      }));

      const { billNo, publicToken } = await createBill({
        customer: { name: label.trim() },
        items: billItems,
        subtotal,
        cgst,
        sgst,
        grandTotal,
        paymentMode: chosenMode,
        ...(chosenMode === 'UPI' && cashCollected.trim() ? { cashCollected: parseFloat(cashCollected) } : {}),
        punchedBy: auth.currentUser?.email ?? 'unknown',
      });

      // Mark as billed first (safety net in case delete fails)
      await markPosOrderBilled(targetId);
      await deletePosOpenOrder(targetId);

      if (targetId === activeOrderId) {
        setActiveOrderId(null);
        setLocalItems([]);
        setLocalLabel('');
      }

      setLastBill({ billNo, publicToken });
      setBillConfirm(null);
    } catch (e) {
      console.error('Billing error:', e);
      alert('Failed to generate bill. Please try again.');
    } finally {
      setBilling(false);
    }
  };

  // ── Discard order ─────────────────────────────────────────────────────────────
  const handleDiscard = async (orderId: string) => {
    if (!confirm('Discard this order?')) return;
    await deletePosOpenOrder(orderId);
    if (orderId === activeOrderId) {
      setActiveOrderId(null);
      setLocalItems([]);
      setLocalLabel('');
    }
  };

  const handleGoToInventory = useCallback(async () => {
    await flushSync();
    router.push('/inventory');
  }, [flushSync, router]);

  const handleLogout = async () => {
    clearAdminBypassSession();
    await signOut(auth);
    router.push(role === 'pos' ? '/pos/login' : '/admin/login');
  };

  // ── Derived ───────────────────────────────────────────────────────────────────
  const categories = useMemo(() => menuTree.filter((n) => n.type === 'category'), [menuTree]);

  const filteredCategories = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return categories;
    return categories.map((cat) => {
      const variants = collectVariants(cat).filter(
        (v) => v.name.toLowerCase().includes(q) || cat.name.toLowerCase().includes(q)
      );
      return { ...cat, _filteredVariants: variants };
    }).filter((cat) => (cat as unknown as { _filteredVariants: MenuTreeNode[] })._filteredVariants.length > 0);
  }, [categories, searchQuery]);

  const { subtotal, cgst, sgst, grandTotal } = useMemo(() => calcTotals(localItems), [localItems]);

  // ── Render guards ─────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50">
        <p className="text-neutral-500 text-sm">Loading…</p>
      </div>
    );
  }
  if (!authenticated || (role !== 'admin' && role !== 'pos')) return null;

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="h-dvh flex flex-col bg-neutral-100 overflow-hidden">

      {/* ── TOP BAR ── */}
      <header className="flex-shrink-0 bg-white border-b border-neutral-200 px-3 py-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => setShowOrdersPanel((v) => !v)}
            className="hidden md:flex p-1.5 rounded hover:bg-neutral-100 text-neutral-500"
            title="Toggle orders panel"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg>
          </button>
          <span className="font-bold text-base md:text-lg text-neutral-900 tracking-tight">DAJAJ POS</span>
          <span className="text-xs bg-orange-100 text-orange-700 font-semibold px-2 py-0.5 rounded-full flex-shrink-0">
            {openOrders.length} open
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={() => router.push('/bills')}
            className="hidden sm:block px-3 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm font-medium rounded-lg transition-colors"
          >
            Bills
          </button>
          {(canManageInventory || role === 'admin') && (
            <button
              onClick={() => void handleGoToInventory()}
              className="hidden sm:block px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Update Inventory
            </button>
          )}
          <button
            onClick={handleLogout}
            className="px-3 py-2 bg-neutral-900 hover:bg-neutral-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Logout
          </button>
        </div>
      </header>

      {/* ── BODY ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* LEFT: Open orders panel */}
        <aside
          className={[
            'flex-col overflow-hidden bg-white border-r border-neutral-200 flex-shrink-0 w-full md:w-56',
            mobileTab === 'orders' ? 'flex' : 'hidden',
            showOrdersPanel ? 'md:flex' : 'md:hidden',
          ].join(' ')}
        >
          <div className="px-3 py-2 border-b border-neutral-100">
            <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Open Orders</p>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {openOrders.length === 0 && todayBills.length === 0 && (
              <p className="text-center text-xs text-neutral-400 mt-6">No open orders.<br />Create a new one.</p>
            )}
            {openOrders.map((order) => {
              const isActive = order.id === activeOrderId;
              const displayItems = order.id === activeOrderId ? localItems : order.items;
              const { grandTotal: oTotal } = calcTotals(displayItems);
              return (
                <div
                  key={order.id}
                  onClick={() => void selectOrder(order)}
                  className={`rounded-xl p-3 cursor-pointer border transition-all group ${
                    isActive
                      ? 'border-orange-400 bg-orange-50 shadow-sm'
                      : 'border-neutral-200 bg-white hover:border-orange-300 hover:bg-orange-50/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-1">
                    <OrderLabel
                      name={isActive ? localLabel : order.label}
                      className="font-semibold text-sm text-neutral-900 truncate leading-tight"
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); void handleDiscard(order.id); }}
                      className="text-neutral-300 hover:text-red-500 text-xs flex-shrink-0 mt-0.5"
                      title="Discard"
                    >✕</button>
                  </div>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {displayItems.length} item{displayItems.length !== 1 ? 's' : ''}
                    {displayItems.length > 0 ? ` · ₹${oTotal.toFixed(0)}` : ''}
                  </p>
                  {/* Item preview: variantLabel + modifiers */}
                  {displayItems.length > 0 && (
                    <p className="text-[10px] text-neutral-400 mt-1 leading-snug line-clamp-2">
                      {displayItems.map((i) => {
                        const parts = [i.variantLabel, ...i.modifiers.map((m) => m.name)].filter(Boolean).join(', ');
                        return `${parts}${i.qty > 1 ? ` ×${i.qty}` : ''}`;
                      }).join(' · ')}
                    </p>
                  )}
                  <p className="text-xs text-neutral-400 mt-0.5">{timeAgo(order.createdAt)}</p>
                  {displayItems.length > 0 ? (
                    <div className="mt-2 flex gap-1.5">
                      <button
                        onClick={(e) => { e.stopPropagation(); void selectOrder(order); }}
                        className="flex-1 text-sm py-2 rounded-lg border border-neutral-300 bg-white text-neutral-700 font-medium hover:border-orange-400 hover:text-orange-600 transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); void handleBill(order.id); }}
                        className="flex-1 text-sm py-2 rounded-lg bg-neutral-900 text-white font-medium hover:bg-orange-600 transition-colors"
                      >
                        Bill ₹{oTotal.toFixed(0)}
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}

            {/* Billed orders section */}
            {todayBills.length > 0 ? (
              <>
                <div className="px-1 pt-3 pb-1">
                  <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Billed Today</p>
                </div>
                {todayBills.map((bill) => {
                  const oTotal = bill.grandTotal;
                  return (
                    <div
                      key={bill.docId}
                      onClick={() => void handleReopenBill(bill)}
                      className="rounded-xl p-3 cursor-pointer border border-neutral-100 bg-neutral-50 hover:border-orange-300 hover:bg-orange-50/40 transition-all opacity-70 hover:opacity-100"
                    >
                      <div className="flex items-start justify-between gap-1">
                        <span className="font-semibold text-sm text-neutral-600 truncate leading-tight">
                          {bill.customer.name || bill.billNo}
                        </span>
                        <span className="text-[10px] font-semibold text-green-600 bg-green-50 px-1.5 py-0.5 rounded-md flex-shrink-0">Billed</span>
                      </div>
                      <p className="text-xs text-neutral-400 mt-0.5">
                        {bill.items.length} item{bill.items.length !== 1 ? 's' : ''}
                        {bill.items.length > 0 ? ` · ₹${oTotal.toFixed(0)}` : ''}
                      </p>
                      {bill.items.length > 0 && (
                        <p className="text-[10px] text-neutral-400 mt-1 leading-snug line-clamp-2">
                          {bill.items.map((i) => {
                            const parts = [i.variant, ...i.addons.map((a) => a.name.split(': ').pop())].filter(Boolean).join(', ');
                            return `${parts}${i.qty > 1 ? ` ×${i.qty}` : ''}`;
                          }).join(' · ')}
                        </p>
                      )}
                      <p className="text-[10px] text-neutral-400 mt-0.5">{bill.billNo} · {bill.paymentMode}</p>
                      <button
                        onClick={(e) => { e.stopPropagation(); void handleReopenBill(bill); }}
                        className="mt-2 w-full text-sm py-2 rounded-lg border border-neutral-300 bg-white text-neutral-700 font-medium hover:border-orange-400 hover:text-orange-600 transition-colors"
                      >
                        Reopen & Edit
                      </button>
                    </div>
                  );
                })}
              </>
            ) : null}
          </div>
          <div className="flex-shrink-0 border-t border-neutral-100 p-2">
            <button
              onClick={() => router.push('/bills')}
              className="w-full text-xs py-2 rounded-lg bg-neutral-50 hover:bg-neutral-100 text-neutral-500 font-medium transition-colors flex items-center justify-center gap-1.5"
            >
              <svg className="w-4 h-4 inline -mt-0.5 mr-1" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15a2.25 2.25 0 0 1 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z" /></svg>Past Bills
            </button>
          </div>
        </aside>

        {/* CENTRE: Menu */}
        <main
          className={[
            'flex-1 flex overflow-hidden bg-neutral-50',
            mobileTab === 'menu' ? 'flex' : 'hidden',
            'md:flex',
          ].join(' ')}
        >
          {/* Category sidebar */}
          <div className="w-28 sm:w-36 flex-shrink-0 overflow-y-auto bg-white border-r border-neutral-200 flex flex-col">
            <div className="py-2">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setExpandedCategoryId(cat.id)}
                  className={`w-full text-left px-3 py-3 text-xs font-semibold leading-tight transition-colors border-l-2 ${
                    expandedCategoryId === cat.id
                      ? 'border-orange-500 bg-orange-50 text-orange-700'
                      : 'border-transparent text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>

          {/* Items area */}
          <div className="flex-1 overflow-y-auto">
            <div className="sticky top-0 z-10 bg-neutral-50 border-b border-neutral-200 px-3 pt-3 pb-2">
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search items…"
                className="w-full px-3 py-2 text-sm rounded-lg border border-neutral-300 bg-white focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
            </div>

            <div className="p-3">
              {!activeOrderId && (
                <div className="mb-4 bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 text-sm text-orange-700 font-medium text-center">
                  Tap <strong>+ New Order</strong> to start adding items
                </div>
              )}

              {menuStatus ? (
                <p className="text-center text-sm text-neutral-400 mt-10">{menuStatus}</p>
              ) : (
                <div>
                  {(searchQuery ? filteredCategories : categories.filter((c) => c.id === expandedCategoryId || expandedCategoryId === null)).map((cat) => {
                    const variants = searchQuery
                      ? (cat as unknown as { _filteredVariants: MenuTreeNode[] })._filteredVariants
                      : collectVariants(cat);
                    const isExpanded = searchQuery || expandedCategoryId === cat.id;

                    return (
                      <section key={cat.id}>
                        {!searchQuery && (
                          <p className="px-1 py-2 font-bold text-neutral-500 text-xs uppercase tracking-widest border-b border-neutral-200 mb-1">
                            {cat.name}
                          </p>
                        )}
                        {isExpanded && (
                          <div className="divide-y divide-neutral-100">
                            {variants.map((variant) => {
                              const unavailable = !variant.isAvailable || !cat.isAvailable;
                              const instant = !unavailable ? getInstantAddModifiers(variant) : null;
                              const needsModal = !unavailable && instant === null;
                              // qty in active order for instant (no-modifier) items
                              const cartItem = instant !== null
                                ? localItems.find((i) => i.variantId === variant.id && i.modifiers.length === 0)
                                : null;
                              const qty = cartItem?.qty ?? 0;

                              return (
                                <div
                                  key={variant.id}
                                  className={`flex items-center gap-3 px-2 py-3 ${unavailable ? 'opacity-50' : ''}`}
                                >
                                  {/* Info */}
                                  <div className="flex-1 min-w-0">
                                    <p className="font-semibold text-neutral-900 text-sm leading-snug truncate">{variant.name}</p>
                                    <p className="text-xs text-neutral-400 mt-0.5">₹{variant.price}</p>
                                    {unavailable && (
                                      <span className="inline-block mt-1 text-[10px] font-bold uppercase tracking-wide bg-red-100 text-red-500 px-1.5 py-0.5 rounded-full">Unavailable</span>
                                    )}
                                  </div>

                                  {/* Action */}
                                  {unavailable ? null : needsModal ? (
                                    /* Has required modifiers — open selector */
                                    <button
                                      type="button"
                                      disabled={!activeOrderId}
                                      onClick={() => { setActiveVariant(variant); setActiveCategoryName(cat.name); }}
                                      className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-bold border transition-colors ${
                                        activeOrderId
                                          ? 'border-orange-400 text-orange-600 hover:bg-orange-50 active:scale-95'
                                          : 'border-neutral-200 text-neutral-400 cursor-not-allowed'
                                      }`}
                                    >
                                      Select
                                    </button>
                                  ) : qty === 0 ? (
                                    /* Not in cart yet */
                                    <button
                                      type="button"
                                      disabled={!activeOrderId}
                                      onClick={() => {
                                        if (!activeOrderId || !instant) return;
                                        addToActiveOrder(variant, cat.name, instant.map((m) => ({
                                          id: m.id, name: m.name, price: m.price, groupName: m.groupName,
                                        })));
                                      }}
                                      className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-lg font-bold transition-colors ${
                                        activeOrderId
                                          ? 'bg-neutral-900 text-white hover:bg-orange-600 active:scale-95'
                                          : 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
                                      }`}
                                    >
                                      +
                                    </button>
                                  ) : (
                                    /* Stepper */
                                    <div className="flex-shrink-0 flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => cartItem && updateQty(cartItem.id, -1)}
                                        className="w-9 h-9 rounded-full flex items-center justify-center text-lg font-bold bg-neutral-100 text-neutral-700 hover:bg-red-100 hover:text-red-600 active:scale-95 transition-colors"
                                      >
                                        −
                                      </button>
                                      <span className="w-6 text-center text-sm font-bold text-neutral-900">{qty}</span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (!instant) return;
                                          addToActiveOrder(variant, cat.name, instant.map((m) => ({
                                            id: m.id, name: m.name, price: m.price, groupName: m.groupName,
                                          })));
                                        }}
                                        className="w-9 h-9 rounded-full flex items-center justify-center text-lg font-bold bg-neutral-900 text-white hover:bg-orange-600 active:scale-95 transition-colors"
                                      >
                                        +
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </main>

        {/* RIGHT: Active order */}
        <aside
          className={[
            'flex-col overflow-hidden bg-white border-l border-neutral-200 flex-shrink-0 w-full md:w-72',
            mobileTab === 'cart' ? 'flex' : 'hidden',
            'md:flex',
          ].join(' ')}
        >
          {!activeOrderId ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6 gap-3">
              <div className="flex items-center justify-center"><svg className="w-10 h-10 text-neutral-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg></div>
              <p className="text-sm text-neutral-500">Select an open order<br />or tap <strong>+ New Order</strong></p>
            </div>
          ) : (
            <>
              {/* Order header */}
              <div className="px-3 py-3 border-b border-neutral-100">
                <input
                  type="text"
                  value={localLabel}
                  onChange={(e) => updateLabel(e.target.value)}
                  placeholder="Customer name"
                  className="w-full px-3 py-2 text-sm font-semibold rounded-lg border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-orange-400 text-neutral-900"
                />
              </div>

              {/* Items list */}
              <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
                {localItems.length === 0 && (
                  <p className="text-center text-xs text-neutral-400 mt-6">No items yet.<br />Add from the menu.</p>
                )}
                {localItems.map((item) => (
                  <div key={item.id} className="flex items-start gap-2 py-2 border-b border-neutral-100 last:border-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-neutral-900 leading-tight truncate">{item.variantLabel}</p>
                      <p className="text-[10px] text-neutral-500 truncate">{item.name}</p>
                      {item.modifiers.length > 0 && (
                        <p className="text-[10px] text-orange-600 truncate">{item.modifiers.map((m) => m.name).join(', ')}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className="text-xs font-bold text-neutral-900">₹{item.itemTotal}</span>
                      <div className="flex items-center gap-1">
                        <button onClick={() => updateQty(item.id, -1)} className="w-8 h-8 flex items-center justify-center rounded-full border border-neutral-300 text-neutral-600 hover:bg-neutral-100 text-sm leading-none">−</button>
                        <span className="text-xs font-semibold w-5 text-center">{item.qty}</span>
                        <button onClick={() => updateQty(item.id, 1)} className="w-8 h-8 flex items-center justify-center rounded-full border border-neutral-300 text-neutral-600 hover:bg-neutral-100 text-sm leading-none">+</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Totals + bill button */}
              {localItems.length > 0 && (
                <div className="border-t border-neutral-200 px-3 py-3 space-y-2 flex-shrink-0">
                  <div className="flex justify-between font-bold text-sm text-neutral-900">
                    <span>Total</span><span>₹{grandTotal.toFixed(2)}</span>
                  </div>

                  <button
                    onClick={() => void handleBill()}
                    disabled={billing}
                    className="w-full py-3 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-xl text-sm transition-colors disabled:opacity-50"
                  >
                    {billing ? 'Generating…' : `Generate Bill · ₹${grandTotal.toFixed(0)}`}
                  </button>
                </div>
              )}
            </>
          )}
        </aside>
      </div>

      {/* ── MOBILE BOTTOM NAV ── */}
      <nav className="md:hidden flex-shrink-0 bg-white border-t border-neutral-200 flex">
        <button
          onClick={() => setMobileTab('orders')}
          className={`relative flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-xs font-medium transition-colors ${
            mobileTab === 'orders' ? 'text-orange-600 bg-orange-50' : 'text-neutral-500'
          }`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15a2.25 2.25 0 0 1 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z" /></svg>
          <span>Orders</span>
          {openOrders.length > 0 && (
            <span className="absolute top-1.5 right-3 min-w-[18px] h-[18px] rounded-full bg-orange-500 text-white text-[10px] font-bold flex items-center justify-center px-1">
              {openOrders.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setMobileTab('menu')}
          className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-xs font-medium transition-colors ${
            mobileTab === 'menu' ? 'text-orange-600 bg-orange-50' : 'text-neutral-500'
          }`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z" /></svg>
          <span>Menu</span>
        </button>
        <button
          onClick={() => setMobileTab('cart')}
          className={`relative flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-xs font-medium transition-colors ${
            mobileTab === 'cart' ? 'text-orange-600 bg-orange-50' : 'text-neutral-500'
          }`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" /></svg>
          <span>{activeOrderId && localItems.length > 0 ? `₹${grandTotal.toFixed(0)}` : 'Cart'}</span>
          {activeOrderId && localItems.length > 0 && (
            <span className="absolute top-1.5 right-3 min-w-[18px] h-[18px] rounded-full bg-orange-500 text-white text-[10px] font-bold flex items-center justify-center px-1">
              {localItems.length}
            </span>
          )}
        </button>
      </nav>

      {/* ── BILL CONFIRM MODAL ── */}
      {billConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5">
            <div>
              <h2 className="text-lg font-bold text-neutral-900">Confirm Bill</h2>
              <p className="text-sm text-neutral-500 mt-0.5">{billConfirm.label} · ₹{billConfirm.grandTotal.toFixed(0)}</p>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2">Payment Mode</p>
              <div className="grid grid-cols-3 gap-2">
                {(['Cash', 'Card', 'UPI'] as PaymentMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setBillConfirm((prev) => prev ? { ...prev, paymentMode: mode } : prev)}
                    className={`py-3 rounded-xl text-sm font-bold border-2 transition-all ${
                      billConfirm.paymentMode === mode
                        ? 'border-orange-500 bg-orange-50 text-orange-700'
                        : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300'
                    }`}
                  >
                    {mode === 'Cash' ? <svg className="w-6 h-6 mx-auto" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" /></svg> : mode === 'UPI' ? <svg className="w-6 h-6 mx-auto" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" /></svg> : <svg className="w-6 h-6 mx-auto" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" /></svg>}<br />
                    <span className="text-xs">{mode}</span>
                  </button>
                ))}
              </div>
            </div>

            {billConfirm.paymentMode === 'UPI' ? (
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-1.5 block">Cash Collected (optional)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="₹ 0"
                  value={billConfirm.cashCollected}
                  onChange={(e) => setBillConfirm((prev) => prev ? { ...prev, cashCollected: e.target.value } : prev)}
                  className="w-full px-3 py-2.5 rounded-xl border-2 border-neutral-200 focus:border-orange-400 focus:outline-none text-sm font-medium"
                />
              </div>
            ) : null}

            <div className="flex gap-3">
              <button
                onClick={() => setBillConfirm(null)}
                disabled={billing}
                className="flex-1 py-2.5 rounded-xl border border-neutral-300 text-sm font-semibold text-neutral-600 hover:bg-neutral-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void confirmBill()}
                disabled={billing}
                className="flex-1 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-sm font-bold transition-colors disabled:opacity-50"
              >
                {billing ? 'Generating…' : `Confirm · ${billConfirm.paymentMode}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── BILL SUCCESS TOAST ── */}
      {lastBill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4 text-center">
            <div className="flex items-center justify-center"><svg className="w-10 h-10 text-emerald-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg></div>
            <div>
              <h2 className="text-lg font-bold text-neutral-900">Bill Generated!</h2>
              <p className="text-xs text-neutral-400 font-mono mt-1">{lastBill.billNo}</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setLastBill(null)}
                className="flex-1 py-2.5 rounded-xl border border-neutral-300 text-sm font-semibold text-neutral-600 hover:bg-neutral-50 transition-colors"
              >
                Close
              </button>
              <a
                href={`/bill/${lastBill.billNo}?token=${encodeURIComponent(lastBill.publicToken)}`}
                className="flex-1 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-sm font-bold transition-colors text-center"
                onClick={() => setLastBill(null)}
              >
                View Bill
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Variant modifier modal */}
      {activeVariant && (
        <VariantModal
          variant={activeVariant}
          categoryName={activeCategoryName}
          open={true}
          onClose={() => setActiveVariant(null)}
          onSubmit={(item) => {
            const posModifiers: PosModifier[] = item.modifiers.map((m) => ({
              id: m.id,
              name: m.name,
              price: m.price,
              groupName: m.groupName,
            }));
            addToActiveOrder(activeVariant, item.categoryName, posModifiers, item.quantity);
            setActiveVariant(null);
          }}
        />
      )}

      {/* ── FLOATING NEW ORDER BUTTON (hidden on cart tab) ── */}
      {mobileTab !== 'cart' && (
        <button
          onClick={handleNewOrder}
          disabled={creatingOrder}
          className="fixed bottom-20 md:bottom-6 right-4 z-40 flex items-center gap-2 px-5 py-3.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-sm font-bold rounded-full shadow-lg transition-colors disabled:opacity-50"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
          {creatingOrder ? 'Creating…' : 'New Order'}
        </button>
      )}
    </div>
  );
}
