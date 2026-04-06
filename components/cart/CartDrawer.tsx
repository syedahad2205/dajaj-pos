"use client";

import { useEffect } from "react";
import CartItem from "@/components/cart/CartItem";
import { useCart } from "@/components/cart/CartProvider";

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
  const { items, itemCount, subtotal, incrementItem, decrementItem, removeItem } = useCart();

  useEffect(() => {
    if (!open) {
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
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">Your Order</p>
              <h2 className="text-2xl font-black text-slate-900">
                {itemCount} {itemCount === 1 ? "item" : "items"}
              </h2>
            </div>
            <button type="button" onClick={onClose} className="rounded-full border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">
              Close
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-5 pb-32">
            <div className="space-y-3">
              {items.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
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

          <div className="border-t border-slate-200 bg-white px-5 py-4">
            <div className="flex items-center justify-between text-sm text-slate-600">
              <span>{itemCount} {itemCount === 1 ? "item" : "items"}</span>
              <span>Order total</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-lg font-black text-slate-900">Total</span>
              <span className="text-2xl font-black text-slate-900">₹{subtotal}</span>
            </div>
            <button
              type="button"
              onClick={onCheckout}
              disabled={items.length === 0}
              className="mt-4 w-full rounded-2xl bg-orange-600 px-5 py-4 text-lg font-semibold text-white"
            >
              Proceed to Checkout
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
