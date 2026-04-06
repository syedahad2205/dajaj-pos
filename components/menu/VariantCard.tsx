"use client";

import type { MenuTreeNode } from "@/lib/menu-builder";

export default function VariantCard({
  categoryName,
  variant,
  onAdd,
}: {
  categoryName: string;
  variant: MenuTreeNode;
  onAdd: () => void;
}) {
  return (
    <article className="flex w-full flex-col gap-3 overflow-hidden rounded-2xl border border-orange-100 bg-white p-4 shadow transition hover:shadow-lg">
      <div className="relative h-36 w-full overflow-hidden rounded-xl bg-gradient-to-br from-orange-100 via-amber-50 to-white">
        {variant.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={variant.imageUrl} alt={variant.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm font-bold uppercase tracking-[0.3em] text-orange-500">
            No Image
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-600">{categoryName}</p>
            <h3 className="break-words text-lg font-black text-slate-900">{variant.name}</h3>
            {variant.description ? <p className="mt-1 text-sm leading-6 text-slate-600">{variant.description}</p> : null}
          </div>
          <span className="whitespace-nowrap text-lg font-black text-slate-900">₹{variant.price}</span>
        </div>

        <button
          type="button"
          onClick={onAdd}
          className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
        >
          Add
        </button>
      </div>
    </article>
  );
}
