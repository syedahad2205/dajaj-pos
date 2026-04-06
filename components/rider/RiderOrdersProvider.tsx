"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRiderAuth } from "@/components/auth/RiderAuthProvider";
import { getAssignmentsForRider, toDeliveryAssignmentRecord, type DeliveryAssignmentRecord } from "@/services/deliveryAssignmentService";
import { getOrdersByRider, type OrderRecord } from "@/services/orderService";

type RiderOrdersContextValue = {
  orders: DeliveryAssignmentRecord[];
  loading: boolean;
  error: string;
  lastUpdatedAt: number | null;
  refreshOrders: () => Promise<void>;
};

const RiderOrdersContext = createContext<RiderOrdersContextValue | null>(null);

export function RiderOrdersProvider({ children }: { children: ReactNode }) {
  const { authenticated, rider } = useRiderAuth();
  const [assignmentOrders, setAssignmentOrders] = useState<DeliveryAssignmentRecord[]>([]);
  const [directOrders, setDirectOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const refreshOrders = useCallback(async () => {
    if (!authenticated || !rider) {
      setAssignmentOrders([]);
      setDirectOrders([]);
      setLoading(false);
      setLastUpdatedAt(null);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const [nextAssignments, nextOrders] = await Promise.all([getAssignmentsForRider(rider.id), getOrdersByRider(rider.id)]);
      setAssignmentOrders(nextAssignments);
      setDirectOrders(nextOrders);
      setLastUpdatedAt(Date.now());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load rider orders.");
    } finally {
      setLoading(false);
    }
  }, [authenticated, rider]);

  useEffect(() => {
    if (!authenticated || !rider) {
      setAssignmentOrders([]);
      setDirectOrders([]);
      setLoading(false);
      setError("");
      setLastUpdatedAt(null);
      return;
    }

    void refreshOrders();
  }, [authenticated, refreshOrders, rider]);

  const orders = useMemo(() => {
    const merged = new Map<string, DeliveryAssignmentRecord>();

    assignmentOrders.forEach((order) => {
      merged.set(order.orderId, order);
    });

    directOrders.forEach((order) => {
      if (!merged.has(order.id)) {
        merged.set(order.id, toDeliveryAssignmentRecord(order));
      }
    });

    return [...merged.values()].sort((left, right) => {
      const leftTime =
        left.createdAt && typeof left.createdAt === "object" && "toDate" in left.createdAt && typeof left.createdAt.toDate === "function"
          ? left.createdAt.toDate().getTime()
          : 0;
      const rightTime =
        right.createdAt && typeof right.createdAt === "object" && "toDate" in right.createdAt && typeof right.createdAt.toDate === "function"
          ? right.createdAt.toDate().getTime()
          : 0;
      return rightTime - leftTime;
    });
  }, [assignmentOrders, directOrders]);

  const value = useMemo<RiderOrdersContextValue>(
    () => ({
      orders,
      loading,
      error,
      lastUpdatedAt,
      refreshOrders,
    }),
    [error, lastUpdatedAt, loading, orders, refreshOrders],
  );

  return <RiderOrdersContext.Provider value={value}>{children}</RiderOrdersContext.Provider>;
}

export function useRiderOrders() {
  const context = useContext(RiderOrdersContext);
  if (!context) {
    throw new Error("useRiderOrders must be used within RiderOrdersProvider");
  }

  return context;
}
