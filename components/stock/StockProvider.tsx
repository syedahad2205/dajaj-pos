"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  subscribeToStockOverrides,
  setStockStatus,
  setModifierMasterStockStatus,
  type StockOverrides,
} from "@/services/stockService";

type StockContextValue = {
  outOfStockIds: Set<string>;
  outOfStockModifierMasters: Set<string>;
  loading: boolean;
  isOutOfStock: (id: string) => boolean;
  isModifierOutOfStock: (modifier: {
    id: string;
    modifierMasterId?: string | null;
  }) => boolean;
  toggleStock: (id: string, outOfStock: boolean) => Promise<void>;
  toggleModifierMasterStock: (
    masterId: string,
    outOfStock: boolean,
  ) => Promise<void>;
};

const StockContext = createContext<StockContextValue | null>(null);

export function StockProvider({ children }: { children: ReactNode }) {
  const [nodeOverrides, setNodeOverrides] = useState<StockOverrides>({});
  const [masterOverrides, setMasterOverrides] = useState<StockOverrides>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = subscribeToStockOverrides(
      (nodes, masters) => {
        setNodeOverrides(nodes);
        setMasterOverrides(masters);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsubscribe;
  }, []);

  const outOfStockIds = useMemo(
    () => new Set(Object.keys(nodeOverrides)),
    [nodeOverrides],
  );

  const outOfStockModifierMasters = useMemo(
    () => new Set(Object.keys(masterOverrides)),
    [masterOverrides],
  );

  const isOutOfStock = useCallback(
    (id: string) => outOfStockIds.has(id),
    [outOfStockIds],
  );

  const isModifierOutOfStock = useCallback(
    (modifier: { id: string; modifierMasterId?: string | null }) => {
      if (outOfStockIds.has(modifier.id)) return true;
      if (
        modifier.modifierMasterId &&
        outOfStockModifierMasters.has(modifier.modifierMasterId)
      )
        return true;
      return false;
    },
    [outOfStockIds, outOfStockModifierMasters],
  );

  const toggleStock = useCallback(
    (id: string, outOfStock: boolean) => setStockStatus(id, outOfStock),
    [],
  );

  const toggleModifierMasterStock = useCallback(
    (masterId: string, outOfStock: boolean) =>
      setModifierMasterStockStatus(masterId, outOfStock),
    [],
  );

  const value = useMemo<StockContextValue>(
    () => ({
      outOfStockIds,
      outOfStockModifierMasters,
      loading,
      isOutOfStock,
      isModifierOutOfStock,
      toggleStock,
      toggleModifierMasterStock,
    }),
    [
      outOfStockIds,
      outOfStockModifierMasters,
      loading,
      isOutOfStock,
      isModifierOutOfStock,
      toggleStock,
      toggleModifierMasterStock,
    ],
  );

  return (
    <StockContext.Provider value={value}>{children}</StockContext.Provider>
  );
}

export function useStock() {
  const context = useContext(StockContext);
  if (!context) {
    throw new Error("useStock must be used within StockProvider");
  }
  return context;
}
