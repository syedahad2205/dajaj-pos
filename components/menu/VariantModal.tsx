"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CartItem, CartModifier } from "@/components/cart/CartProvider";
import ModifierGroup from "@/components/menu/ModifierGroup";
import type { MenuTreeNode } from "@/lib/menu-builder";

export type SelectedModifiers = Record<string, string[]>;

function getModifierGroups(variant: MenuTreeNode) {
  return variant.children.filter((child) => child.type === "modifierGroup");
}

function getModifierOptions(group: MenuTreeNode) {
  return group.children.filter((child) => child.type === "modifier");
}

function getDefaultSelections(variant: MenuTreeNode): SelectedModifiers {
  const initial: SelectedModifiers = {};

  for (const group of getModifierGroups(variant)) {
    const firstModifier = getModifierOptions(group)[0];
    initial[group.id] = firstModifier && firstModifier.price === 0 ? [firstModifier.id] : [];
  }

  return initial;
}

export function buildInitialSelections(variant: MenuTreeNode, cartItem?: CartItem | null): SelectedModifiers {
  const initial = getDefaultSelections(variant);

  for (const group of getModifierGroups(variant)) {
    const selected =
      cartItem?.modifiers.filter((modifier) => modifier.groupId === group.id).map((modifier) => modifier.id) ?? [];

    if (selected.length > 0) {
      initial[group.id] = selected;
    }
  }

  return initial;
}

export function toCartModifiers(variant: MenuTreeNode, selectedModifiers: SelectedModifiers): CartModifier[] {
  const modifiers: CartModifier[] = [];

  for (const group of getModifierGroups(variant)) {
    const selectedIds = selectedModifiers[group.id] ?? [];
    const groupModifiers = getModifierOptions(group).filter((child) => selectedIds.includes(child.id));

    for (const modifier of groupModifiers) {
      modifiers.push({
        id: modifier.id,
        name: modifier.name,
        price: modifier.price,
        groupId: group.id,
        groupName: group.name,
        modifierMasterId: modifier.modifierMasterId || undefined,
      });
    }
  }

  return modifiers;
}

export function getInstantAddModifiers(variant: MenuTreeNode) {
  const groups = getModifierGroups(variant);
  if (groups.length === 0) {
    return [];
  }

  if (groups.some((group) => group.minSelection > 0)) {
    return null;
  }

  return toCartModifiers(variant, getDefaultSelections(variant));
}

function hasValidSelections(variant: MenuTreeNode, selectedModifiers: SelectedModifiers) {
  return getModifierGroups(variant).every((group) => {
    const selectedCount = selectedModifiers[group.id]?.length ?? 0;
    if (selectedCount < group.minSelection) {
      return false;
    }

    if (group.maxSelection > 0 && selectedCount > group.maxSelection) {
      return false;
    }

    return true;
  });
}

function getModifierError(group: MenuTreeNode) {
  if (group.minSelection === 1) {
    return `Please select at least one ${group.name.toLowerCase()}.`;
  }

  if (group.minSelection > 1) {
    return `Please select at least ${group.minSelection} ${group.name.toLowerCase()}.`;
  }

  return null;
}

export default function VariantModal({
  variant,
  categoryName,
  cartItem,
  open,
  outOfStockIds,
  outOfStockModifierMasters,
  onClose,
  onSubmit,
}: {
  variant: MenuTreeNode | null;
  categoryName: string;
  cartItem?: CartItem | null;
  open: boolean;
  outOfStockIds?: Set<string>;
  outOfStockModifierMasters?: Set<string>;
  onClose: () => void;
  onSubmit: (item: Omit<CartItem, "id">, existingId?: string) => void;
}) {
  const [selectedModifiers, setSelectedModifiers] = useState<SelectedModifiers>({});
  const [quantity, setQuantity] = useState(1);
  const outOfStockRef = useRef(outOfStockIds);
  outOfStockRef.current = outOfStockIds;
  const outOfStockMastersRef = useRef(outOfStockModifierMasters);
  outOfStockMastersRef.current = outOfStockModifierMasters;

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

  useEffect(() => {
    if (!variant) {
      return;
    }

    const initial = buildInitialSelections(variant, cartItem);
    const oos = outOfStockRef.current;
    const oosMasters = outOfStockMastersRef.current;
    const isOOS = (mod: MenuTreeNode) =>
      (oos?.has(mod.id) ?? false) ||
      Boolean(mod.modifierMasterId && oosMasters?.has(mod.modifierMasterId));

    for (const group of getModifierGroups(variant)) {
      if (oos?.has(group.id)) {
        initial[group.id] = [];
      } else {
        initial[group.id] = (initial[group.id] ?? []).filter((id) => {
          const mod = getModifierOptions(group).find((m) => m.id === id);
          return mod ? !isOOS(mod) : true;
        });
      }
    }
    setSelectedModifiers(initial);
    setQuantity(cartItem?.quantity ?? 1);
  }, [variant, cartItem]);

  const modifiers = useMemo(() => {
    if (!variant) {
      return [];
    }

    return toCartModifiers(variant, selectedModifiers);
  }, [selectedModifiers, variant]);

  const total = useMemo(() => {
    if (!variant) {
      return 0;
    }

    const modifierTotal = modifiers.reduce((sum, modifier) => sum + modifier.price, 0);
    return (variant.price + modifierTotal) * quantity;
  }, [modifiers, quantity, variant]);

  if (!open || !variant) {
    return null;
  }

  const groups = getModifierGroups(variant);
  const validSelections = hasValidSelections(variant, selectedModifiers);
  const firstInvalidGroup = groups.find((group) => {
    const selectedCount = selectedModifiers[group.id]?.length ?? 0;
    return selectedCount < group.minSelection;
  });
  const modifierError = firstInvalidGroup ? getModifierError(firstInvalidGroup) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40">
      <div className="flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl md:mx-auto md:max-w-2xl md:rounded-3xl">
        <div className="flex items-start justify-between border-b border-slate-200 p-4">
          <div>
            <p className="text-2xl font-black text-slate-900">Customize your {variant.name}</p>
            <p className="mt-1 text-xs text-slate-500">{categoryName}</p>
            <p className="mt-1 text-sm text-slate-500">Starting from ₹{variant.price}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="space-y-4 pb-4">
            {variant.description ? <p className="text-sm leading-6 text-slate-600">{variant.description}</p> : null}
            {groups.map((group) => (
              <ModifierGroup
                key={group.id}
                group={group}
                selectedModifierIds={selectedModifiers[group.id] ?? []}
                outOfStockIds={outOfStockIds}
                outOfStockModifierMasters={outOfStockModifierMasters}
                onToggleModifier={(targetGroup, modifier) => {
                  setSelectedModifiers((current) => {
                    const selectedIds = current[targetGroup.id] ?? [];

                    if (targetGroup.selectionType === "single") {
                      return {
                        ...current,
                        [targetGroup.id]: [modifier.id],
                      };
                    }

                    const exists = selectedIds.includes(modifier.id);
                    if (exists) {
                      return {
                        ...current,
                        [targetGroup.id]: selectedIds.filter((id) => id !== modifier.id),
                      };
                    }

                    if (targetGroup.maxSelection > 0 && selectedIds.length >= targetGroup.maxSelection) {
                      return current;
                    }

                    return {
                      ...current,
                      [targetGroup.id]: [...selectedIds, modifier.id],
                    };
                  });
                }}
              />
            ))}
          </div>
        </div>

        <div className="sticky bottom-0 border-t border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setQuantity((current) => Math.max(1, current - 1))}
                className="h-11 w-11 rounded-full border border-slate-300 text-lg font-bold text-slate-700"
              >
                −
              </button>
              <span className="min-w-8 text-center text-lg font-black text-slate-900">{quantity}</span>
              <button
                type="button"
                onClick={() => setQuantity((current) => current + 1)}
                className="h-11 w-11 rounded-full border border-slate-300 text-lg font-bold text-slate-700"
              >
                +
              </button>
            </div>
            <div className="text-right">
              <p className="text-sm text-slate-500">Total</p>
              <p className="text-2xl font-black text-slate-900">₹{total}</p>
            </div>
          </div>

          <button
            type="button"
            disabled={!validSelections}
            onClick={() =>
              onSubmit(
                {
                  categoryName,
                  variantId: variant.id,
                  variantName: variant.name,
                  basePrice: variant.price,
                  modifiers,
                  quantity,
                  totalPrice: total,
                  imageUrl: variant.imageUrl,
                  description: variant.description,
                },
                cartItem?.id,
              )
            }
            className="w-full rounded-2xl bg-slate-900 px-5 py-4 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cartItem ? "Update Cart Item" : "Add to Cart"}
          </button>
          {!validSelections && modifierError ? <p className="mt-2 text-center text-sm font-medium text-rose-600">{modifierError}</p> : null}
        </div>
      </div>
    </div>
  );
}
