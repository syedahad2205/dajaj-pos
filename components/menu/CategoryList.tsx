"use client";

import type { MenuTreeNode } from "@/lib/menu-builder";

export default function CategoryList({
  categories,
  selectedCategoryId,
  onSelect,
}: {
  categories: MenuTreeNode[];
  selectedCategoryId: string | null;
  onSelect: (categoryId: string) => void;
}) {
  return (
    <div className="flex w-full flex-wrap gap-2">
      {categories.map((category) => {
        const active = category.id === selectedCategoryId;

        return (
          <button
            key={category.id}
            type="button"
            onClick={() => onSelect(category.id)}
            className={`w-full rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition sm:w-auto ${
              active
                ? "border-orange-500 bg-orange-500 text-white shadow-lg"
                : "border-slate-200 bg-white text-slate-700 shadow-sm"
            }`}
          >
            {category.name}
          </button>
        );
      })}
    </div>
  );
}
