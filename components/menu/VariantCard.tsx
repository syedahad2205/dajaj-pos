"use client";

import type { MenuTreeNode } from "@/lib/menu-builder";

export default function VariantCard({
  categoryName,
  variant,
  quantity,
  showCategory,
  onAdd,
  onIncrement,
  onDecrement,
}: {
  categoryName?: string;
  variant: MenuTreeNode;
  quantity: number;
  showCategory?: boolean;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
}) {
  const hasModifiers = variant.children.some((c) => c.type === "modifierGroup");
  const showStepper = !hasModifiers && quantity > 0;

  return (
    <article className="rounded-2xl border border-orange-100/80 bg-white px-5 py-4 transition hover:border-orange-200 hover:shadow-[0_4px_24px_rgba(194,65,12,0.08)]">
      {showCategory && categoryName ? (
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-orange-500">{categoryName}</p>
      ) : null}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold text-slate-900">{variant.name}</h3>
          <p className="mt-0.5 text-sm font-extrabold text-slate-700">₹{variant.price}</p>
          {variant.description ? (
            <p className="mt-1 text-xs leading-relaxed text-slate-400">{variant.description}</p>
          ) : null}
          {hasModifiers ? (
            <p className="mt-1 text-[11px] font-medium text-orange-500">Customisable</p>
          ) : null}
        </div>

        {/* Fixed-width action area so layout never shifts */}
        <div className="flex w-[5.5rem] shrink-0 items-start justify-end pt-0.5">
          {showStepper ? (
            <div className="flex w-full items-center justify-between rounded-lg border-2 border-orange-600">
              <button
                type="button"
                onClick={onDecrement}
                className="px-2.5 py-1.5 text-sm font-bold text-orange-600 active:scale-90"
              >
                −
              </button>
              <span className="text-sm font-extrabold text-orange-600">{quantity}</span>
              <button
                type="button"
                onClick={onIncrement}
                className="px-2.5 py-1.5 text-sm font-bold text-orange-600 active:scale-90"
              >
                +
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onAdd}
              className="w-full rounded-lg border-2 border-orange-600 py-1.5 text-center text-sm font-bold text-orange-600 transition hover:bg-orange-600 hover:text-white active:scale-95"
            >
              ADD
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
