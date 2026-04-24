"use client";

import type { MenuTreeNode } from "@/lib/menu-builder";

export default function VariantCard({
  variant,
  quantity,
  onAdd,
  onIncrement,
  onDecrement,
}: {
  categoryName?: string;
  variant: MenuTreeNode;
  quantity: number;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
}) {
  const hasModifiers = variant.children.some((c) => c.type === "modifierGroup");
  const showStepper = !hasModifiers && quantity > 0;

  return (
    <article className="group flex items-start gap-4 rounded-2xl border border-orange-100/80 bg-white px-5 py-4 transition hover:border-orange-200 hover:shadow-[0_4px_24px_rgba(194,65,12,0.08)]">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-base font-bold text-slate-900">{variant.name}</h3>
          <span className="shrink-0 text-base font-extrabold text-slate-900">₹{variant.price}</span>
        </div>
        {variant.description ? (
          <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{variant.description}</p>
        ) : null}
        {hasModifiers ? (
          <p className="mt-1.5 text-xs font-medium text-orange-500">Customisable</p>
        ) : null}
      </div>

      {showStepper ? (
        <div className="mt-0.5 flex shrink-0 items-center gap-1 rounded-xl border-2 border-orange-600 overflow-hidden">
          <button
            type="button"
            onClick={onDecrement}
            className="px-3 py-2 text-sm font-bold text-orange-600 transition hover:bg-orange-50 active:scale-95"
          >
            −
          </button>
          <span className="min-w-[1.5rem] text-center text-sm font-extrabold text-orange-600">{quantity}</span>
          <button
            type="button"
            onClick={onIncrement}
            className="px-3 py-2 text-sm font-bold text-orange-600 transition hover:bg-orange-50 active:scale-95"
          >
            +
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onAdd}
          className="mt-0.5 shrink-0 rounded-xl border-2 border-orange-600 px-4 py-2 text-sm font-bold text-orange-600 transition hover:bg-orange-600 hover:text-white active:scale-95"
        >
          ADD
        </button>
      )}
    </article>
  );
}
