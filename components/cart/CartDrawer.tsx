"use client";

import { useEffect, useState } from "react";
import CartItem from "@/components/cart/CartItem";
import { useCart } from "@/components/cart/CartProvider";
import { trackEvent } from "@/lib/analytics";

export default function CartDrawer({
  open,
  onClose,
  onEditItem,
  onCheckout,
}: {
  open: boolean;
  onClose: () => void;
  onEditItem: (itemId: string) => void;
  onCheckout: () => void;
}) {
  const { items, itemCount, subtotal, incrementItem, decrementItem, removeItem, clearCart } = useCart();
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!open) {
      setConfirmClear(false);
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyPosition = document.body.style.position;
    const previousBodyWidth = document.body.style.width;
    const previousBodyTop = document.body.style.top;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const scrollY = window.scrollY;

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.width = "100%";
    document.body.style.top = `-${scrollY}px`;

    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.position = previousBodyPosition;
      document.body.style.width = previousBodyWidth;
      document.body.style.top = previousBodyTop;
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  return (
    <>
      {open ? <button type="button" onClick={onClose} className="fixed inset-0 z-40 bg-slate-950/45" /> : null}
      <aside
        className={`fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[85vh] w-full max-w-[480px] rounded-t-3xl bg-[#fffaf3] shadow-[0_-20px_60px_rgba(15,23,42,0.25)] transition-transform duration-300 ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-600">Your Order</p>
              <h2 className="text-lg font-black text-slate-900">
                {itemCount} {itemCount === 1 ? "item" : "items"}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {items.length > 0 && (
                <button type="button" onClick={() => setConfirmClear(true)} className="rounded-full border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50">
                  Clear All
                </button>
              )}
              <button type="button" onClick={onClose} className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700">
                Close
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 pb-32">
            <div className="space-y-2">
              {items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
                  Your cart is empty.
                </div>
              ) : (
                items.map((item) => (
                  <CartItem
                    key={item.id}
                    item={item}
                    onEdit={() => onEditItem(item.id)}
                    onIncrement={() => incrementItem(item.id)}
                    onDecrement={() => decrementItem(item.id)}
                    onRemove={() => removeItem(item.id)}
                  />
                ))
              )}
            </div>
          </div>

          <div className="border-t border-slate-200 bg-white px-4 py-3">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>{itemCount} {itemCount === 1 ? "item" : "items"}</span>
              <span>Order total</span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-base font-black text-slate-900">Total</span>
              <span className="text-xl font-black text-slate-900">₹{subtotal}</span>
            </div>
            <button
              type="button"
              onClick={onCheckout}
              disabled={items.length === 0}
              className="mt-3 w-full rounded-2xl bg-orange-600 px-5 py-3.5 text-base font-semibold text-white"
            >
              Proceed to Checkout
            </button>
          </div>
        </div>
      </aside>

      {/* Clear All confirmation popup */}
      {confirmClear && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xs rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="text-lg font-black text-slate-900">Clear cart?</h3>
            <p className="mt-1.5 text-sm text-slate-500">
              This will remove all {itemCount} {itemCount === 1 ? "item" : "items"} from your cart.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  void trackEvent("cart_clear_all", { item_count: itemCount, cart_value: subtotal });
                  clearCart();
                  setConfirmClear(false);
                }}
                className="flex-1 rounded-xl bg-rose-600 py-2.5 text-sm font-bold text-white transition hover:bg-rose-700"
              >
                Yes, clear all
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="flex-1 rounded-xl border border-slate-300 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
