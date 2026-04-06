"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type CartModifier = {
  id: string;
  name: string;
  price: number;
  groupId: string;
  groupName: string;
};

export type CartItem = {
  id: string;
  categoryName: string;
  variantId: string;
  variantName: string;
  basePrice: number;
  modifiers: CartModifier[];
  quantity: number;
  totalPrice: number;
  imageUrl: string;
  description: string;
};

type CartContextValue = {
  items: CartItem[];
  itemCount: number;
  subtotal: number;
  addItem: (item: Omit<CartItem, "id">) => void;
  updateItem: (id: string, item: Omit<CartItem, "id">) => void;
  removeItem: (id: string) => void;
  incrementItem: (id: string) => void;
  decrementItem: (id: string) => void;
  clearCart: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

function getNextQuantityPrice(item: CartItem, quantity: number) {
  const perUnit = item.basePrice + item.modifiers.reduce((sum, modifier) => sum + modifier.price, 0);
  return perUnit * quantity;
}

function getModifierSignature(item: Pick<CartItem, "variantId" | "modifiers">) {
  const modifierIds = item.modifiers.map((modifier) => modifier.id).sort();
  return `${item.variantId}:${JSON.stringify(modifierIds)}`;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);

  useEffect(() => {
    const saved = window.localStorage.getItem("dajaj-cart");
    if (!saved) {
      return;
    }

    try {
      setItems(JSON.parse(saved) as CartItem[]);
    } catch {
      window.localStorage.removeItem("dajaj-cart");
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("dajaj-cart", JSON.stringify(items));
  }, [items]);

  const value = useMemo<CartContextValue>(() => {
    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);

    return {
      items,
      itemCount,
      subtotal,
      addItem: (item) => {
        setItems((current) => {
          const signature = getModifierSignature(item);
          const existing = current.find((entry) => getModifierSignature(entry) === signature);

          if (!existing) {
            return [
              ...current,
              {
                ...item,
                id: crypto.randomUUID(),
              },
            ];
          }

          return current.map((entry) =>
            entry.id === existing.id
              ? {
                  ...entry,
                  quantity: entry.quantity + item.quantity,
                  totalPrice: getNextQuantityPrice(entry, entry.quantity + item.quantity),
                }
              : entry,
          );
        });
      },
      updateItem: (id, item) => {
        setItems((current) => {
          const nextItem: CartItem = { ...item, id };
          const signature = getModifierSignature(nextItem);
          const matching = current.find((entry) => entry.id !== id && getModifierSignature(entry) === signature);

          if (!matching) {
            return current.map((entry) => (entry.id === id ? nextItem : entry));
          }

          return current
            .filter((entry) => entry.id !== id)
            .map((entry) =>
              entry.id === matching.id
                ? {
                    ...entry,
                    quantity: entry.quantity + nextItem.quantity,
                    totalPrice: getNextQuantityPrice(entry, entry.quantity + nextItem.quantity),
                  }
                : entry,
            );
        });
      },
      removeItem: (id) => {
        setItems((current) => current.filter((item) => item.id !== id));
      },
      incrementItem: (id) => {
        setItems((current) =>
          current.map((item) =>
            item.id === id
              ? {
                  ...item,
                  quantity: item.quantity + 1,
                  totalPrice: getNextQuantityPrice(item, item.quantity + 1),
                }
              : item,
          ),
        );
      },
      decrementItem: (id) => {
        setItems((current) =>
          current
            .map((item) =>
              item.id === id
                ? {
                    ...item,
                    quantity: item.quantity - 1,
                    totalPrice: getNextQuantityPrice(item, item.quantity - 1),
                  }
                : item,
            )
            .filter((item) => item.quantity > 0),
        );
      },
      clearCart: () => {
        setItems([]);
      },
    };
  }, [items]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used within CartProvider");
  }

  return context;
}
