"use client";

import VariantCard from "@/components/menu/VariantCard";
import type { MenuTreeNode } from "@/lib/menu-builder";

export default function VariantGrid({
  categoryName,
  variants,
  onAdd,
}: {
  categoryName: string;
  variants: MenuTreeNode[];
  onAdd: (variant: MenuTreeNode) => void;
}) {
  if (variants.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center text-sm text-slate-500">
        No items available in {categoryName} right now.
      </div>
    );
  }

  return (
    <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {variants.map((variant) => (
        <VariantCard
          key={variant.id}
          categoryName={categoryName}
          variant={variant}
          onAdd={() => onAdd(variant)}
        />
      ))}
    </div>
  );
}
