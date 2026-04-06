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
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <button type="button" onClick={onEdit} className="w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="space-y-1">
              <h3 className="text-lg font-bold text-slate-900">{item.categoryName}</h3>
              <p className="text-sm text-slate-500">{item.variantName}</p>
            </div>
            {item.modifiers.length > 0 ? (
              <p className="mt-3 text-xs text-slate-400">
                {item.modifiers.map((modifier) => modifier.name).join(" • ")}
              </p>
            ) : null}
          </div>
          <span className="text-base font-black text-slate-900">₹{item.totalPrice}</span>
        </div>
      </button>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onDecrement}
            className="h-10 w-10 rounded-full border border-slate-300 text-lg font-bold text-slate-700"
          >
            −
          </button>
          <span className="w-8 text-center text-base font-bold text-slate-900">{item.quantity}</span>
          <button
            type="button"
            onClick={onIncrement}
            className="h-10 w-10 rounded-full border border-slate-300 text-lg font-bold text-slate-700"
          >
            +
          </button>
        </div>

        <button type="button" onClick={onRemove} className="text-sm font-semibold text-rose-600">
          Remove
        </button>
      </div>
    </div>
  );
}
