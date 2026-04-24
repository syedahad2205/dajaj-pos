"use client";

import type { CartItem as CartItemType } from "@/components/cart/CartProvider";

export default function CartItem({
  item,
  onEdit,
  onIncrement,
  onDecrement,
  onRemove,
}: {
  item: CartItemType;
  onEdit: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-3 shadow-sm">
      <button type="button" onClick={onEdit} className="w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-900">{item.variantName}</h3>
            <p className="text-xs text-slate-400">{item.categoryName}</p>
            {item.modifiers.length > 0 ? (
              <p className="mt-1 text-[11px] text-slate-400">
                {item.modifiers.map((modifier) => modifier.name).join(" · ")}
              </p>
            ) : null}
          </div>
          <span className="text-sm font-extrabold text-slate-900">₹{item.totalPrice}</span>
        </div>
      </button>

      <div className="mt-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onDecrement}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 text-sm font-bold text-slate-700"
          >
            −
          </button>
          <span className="w-6 text-center text-sm font-bold text-slate-900">{item.quantity}</span>
          <button
            type="button"
            onClick={onIncrement}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 text-sm font-bold text-slate-700"
          >
            +
          </button>
        </div>

        <button type="button" onClick={onRemove} className="text-xs font-semibold text-rose-600">
          Remove
        </button>
      </div>
    </div>
  );
}
