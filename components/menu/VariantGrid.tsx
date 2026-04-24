"use client";

import VariantCard from "@/components/menu/VariantCard";
import type { MenuTreeNode } from "@/lib/menu-builder";
import type { CartItem } from "@/components/cart/CartProvider";

export default function VariantGrid({
  categoryName,
  variants,
  cartItems,
  onAdd,
  onIncrement,
  onDecrement,
}: {
  categoryName: string;
  variants: MenuTreeNode[];
  cartItems: CartItem[];
  onAdd: (variant: MenuTreeNode) => void;
  onIncrement: (variantId: string) => void;
  onDecrement: (variantId: string) => void;
}) {
  if (variants.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center text-sm text-slate-400">
        No items available in {categoryName} right now.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {variants.map((variant) => {
        const qty = cartItems
          .filter((item) => item.variantId === variant.id)
          .reduce((sum, item) => sum + item.quantity, 0);

        return (
          <VariantCard
            key={variant.id}
            categoryName={categoryName}
            variant={variant}
            quantity={qty}
            onAdd={() => onAdd(variant)}
            onIncrement={() => onIncrement(variant.id)}
            onDecrement={() => onDecrement(variant.id)}
          />
        );
      })}
    </div>
  );
}
