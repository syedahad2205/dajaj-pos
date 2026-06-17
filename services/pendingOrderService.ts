import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { firestore } from "@/lib/firebase";

export type PendingOrderStatus = "pending" | "accepted" | "rejected";

export type OrderChannel = "whatsapp" | "website" | "qr" | "swiggy" | "zomato";

export interface PendingOrderItem {
  name: string;
  qty: number;
  price: number;
  total: number;
}

export interface PendingOrderRecord {
  id: string;
  restaurantId: string;
  orderNumber: string;
  channel: OrderChannel;
  status: PendingOrderStatus;
  customerName: string;
  customerPhone: string;
  items: PendingOrderItem[];
  total: number;
  orderType: string;
  deliveryAddress: string | null;
  notes: string | null;
  rejectionReason: string | null;
  createdAt: unknown;
  processedAt: unknown;
}

function pendingOrdersCollection() {
  return collection(firestore, "pending_orders");
}

function pendingOrderDoc(orderId: string) {
  return doc(firestore, "pending_orders", orderId);
}

/**
 * Maps a Firestore document snapshot to a PendingOrderRecord.
 */
function mapPendingOrder(snapshotDoc: { id: string; data: () => unknown }): PendingOrderRecord {
  const raw = snapshotDoc.data() as Record<string, unknown>;

  const items = (raw.items as Array<Record<string, unknown>> | undefined) ?? [];

  return {
    id: snapshotDoc.id,
    restaurantId: (raw.restaurantId as string) || "",
    orderNumber: (raw.orderNumber as string) || snapshotDoc.id,
    channel: (raw.channel as OrderChannel) || "website",
    status: (raw.status as PendingOrderStatus) || "pending",
    customerName: (raw.customerName as string) || "Customer",
    customerPhone: (raw.customerPhone as string) || "",
    items: items.map((item) => ({
      name: (item.name as string) || "",
      qty: (item.qty as number) || 1,
      price: (item.price as number) || 0,
      total: (item.total as number) || 0,
    })),
    total: (raw.total as number) || 0,
    orderType: (raw.orderType as string) || "walk_in",
    deliveryAddress: (raw.deliveryAddress as string) || null,
    notes: (raw.notes as string) || null,
    rejectionReason: (raw.rejectionReason as string) || null,
    createdAt: raw.createdAt,
    processedAt: raw.processedAt,
  };
}

/**
 * Subscribes to pending orders in real-time via Firestore listener.
 * Filters by restaurantId and status=pending, sorted by createdAt ascending (oldest first).
 * Returns an unsubscribe function.
 *
 * @param restaurantId - Restaurant identifier
 * @param callback - Called with updated list of pending orders
 * @param onError - Called on listener errors (e.g., disconnects)
 */
export function subscribeToPendingOrders(
  restaurantId: string,
  callback: (orders: PendingOrderRecord[]) => void,
  onError?: (error: Error) => void,
): () => void {
  const pendingQuery = query(
    pendingOrdersCollection(),
    where("restaurantId", "==", restaurantId),
    where("status", "==", "pending"),
    orderBy("createdAt", "asc"),
  );

  return onSnapshot(
    pendingQuery,
    (snapshot) => {
      const orders = snapshot.docs.map(mapPendingOrder);
      callback(orders);
    },
    (error) => {
      console.error("[pendingOrders] Firestore listener error:", error.code, error.message);
      if (onError) {
        onError(error);
      }
    },
  );
}

/**
 * Accepts a pending order using a Firestore transaction.
 * - Verifies the order is still in "pending" status (concurrency safety).
 * - Updates status to "accepted" with processedAt timestamp.
 * - Does NOT generate KOT or trigger printing (Web Dashboard exclusion per requirement 4.10).
 *
 * @throws Error if the order has already been processed by another user.
 */
export async function acceptPendingOrder(orderId: string): Promise<void> {
  const orderRef = pendingOrderDoc(orderId);

  await runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(orderRef);

    if (!snapshot.exists()) {
      throw new Error("Order not found");
    }

    const data = snapshot.data();
    const currentStatus = data?.status as string;

    if (currentStatus !== "pending") {
      throw new Error(`Order has already been ${currentStatus} by another user`);
    }

    transaction.update(orderRef, {
      status: "accepted",
      processedAt: serverTimestamp(),
    });
  });
}

/**
 * Rejects a pending order using a Firestore transaction.
 * - Validates rejection reason is between 1-200 characters.
 * - Verifies the order is still in "pending" status (concurrency safety).
 * - Updates status to "rejected" with reason and processedAt timestamp.
 *
 * @throws Error if reason is invalid or order has already been processed.
 */
export async function rejectPendingOrder(orderId: string, reason: string): Promise<void> {
  const trimmedReason = reason.trim();

  if (trimmedReason.length < 1 || trimmedReason.length > 200) {
    throw new Error("Rejection reason must be between 1 and 200 characters");
  }

  const orderRef = pendingOrderDoc(orderId);

  await runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(orderRef);

    if (!snapshot.exists()) {
      throw new Error("Order not found");
    }

    const data = snapshot.data();
    const currentStatus = data?.status as string;

    if (currentStatus !== "pending") {
      throw new Error(`Order has already been ${currentStatus} by another user`);
    }

    transaction.update(orderRef, {
      status: "rejected",
      rejectionReason: trimmedReason,
      processedAt: serverTimestamp(),
    });
  });
}
