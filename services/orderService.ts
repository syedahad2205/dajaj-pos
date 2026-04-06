import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import { logFirestoreDebug, trackFirestoreRead } from "@/lib/firestoreReadTracker";
import type { Address } from "@/lib/addresses";
import type { CartItem } from "@/components/cart/CartProvider";
import type { PaymentMethodId } from "@/lib/paymentMethods";

export type PaymentStatus = "pending" | "paid" | "failed" | "refunded";
export type DeliveryStatus = "unassigned" | "assigned" | "on_the_way" | "delivered";
export type OrderStatus =
  | "pending"
  | "accepted"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "delivered"
  | "cancelled";

export interface OrderRecord {
  id: string;
  orderNumber: string;
  userId: string;
  customerName: string;
  customerPhone: string;
  address: Address;
  location: {
    lat: number;
    lng: number;
  };
  items: CartItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  paymentMethod: PaymentMethodId;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  deliveryStatus: DeliveryStatus;
  assignedRiderId: string;
  assignedRiderName: string;
  assignedRiderPhone: string;
  pickedUpAt?: unknown;
  deliveredAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CreateOrderInput {
  userId: string;
  customerName: string;
  customerPhone: string;
  address: Address;
  location: {
    lat: number;
    lng: number;
  };
  items: CartItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  paymentMethod: PaymentMethodId;
}

export function ordersCollection() {
  return collection(firestore, "orders");
}

export function orderDoc(orderId: string) {
  return doc(firestore, "orders", orderId);
}

function deriveDeliveryStatus(raw: Partial<OrderRecord> & { status?: OrderStatus }) {
  if (raw.deliveryStatus) {
    return raw.deliveryStatus;
  }

  if (raw.orderStatus === "delivered" || raw.status === "delivered") {
    return "delivered";
  }

  if (raw.orderStatus === "out_for_delivery" || raw.status === "out_for_delivery") {
    return "on_the_way";
  }

  if (raw.assignedRiderId) {
    return "assigned";
  }

  return "unassigned";
}

function mapOrder(snapshotDoc: { id: string; data: () => unknown }) {
  const raw = snapshotDoc.data() as Partial<OrderRecord> & {
    status?: OrderStatus;
    payment_method?: PaymentMethodId;
  };

  return {
    id: snapshotDoc.id,
    orderNumber: raw.orderNumber || snapshotDoc.id,
    userId: raw.userId || "",
    customerName: raw.customerName || raw.address?.name || "Customer",
    customerPhone: raw.customerPhone || raw.address?.phone || "",
    address: raw.address as Address,
    location: raw.location || {
      lat: raw.address?.latitude || 0,
      lng: raw.address?.longitude || 0,
    },
    items: raw.items || [],
    subtotal: raw.subtotal || 0,
    deliveryFee: raw.deliveryFee || 0,
    total: raw.total || 0,
    paymentMethod: raw.paymentMethod || raw.payment_method || "cod",
    paymentStatus: raw.paymentStatus || "pending",
    orderStatus: raw.orderStatus || raw.status || "pending",
    deliveryStatus: deriveDeliveryStatus(raw),
    assignedRiderId: raw.assignedRiderId || "",
    assignedRiderName: raw.assignedRiderName || "",
    assignedRiderPhone: raw.assignedRiderPhone || "",
    pickedUpAt: raw.pickedUpAt,
    deliveredAt: raw.deliveredAt,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  } satisfies OrderRecord;
}

async function getNextOrderNumber() {
  const counterRef = doc(firestore, "counters", "orders");

  return runTransaction(firestore, async (transaction) => {
    const counterDoc = await transaction.get(counterRef);
    const counterData = counterDoc.data() as { value?: number; current?: number } | undefined;
    const current = counterData?.value ?? counterData?.current ?? 1000;
    const next = current + 1;
    trackFirestoreRead("counters/orders transaction.get", { current, next });

    transaction.set(counterRef, { value: next }, { merge: true });
    return String(next);
  });
}

export async function createOrder(input: CreateOrderInput) {
  logFirestoreDebug("createOrder called", {
    userId: input.userId,
    itemCount: input.items.length,
    total: input.total,
  });
  const orderNumber = await getNextOrderNumber();
  const orderRef = doc(ordersCollection(), orderNumber);

  await setDoc(orderRef, {
    ...input,
    id: orderRef.id,
    orderNumber,
    paymentStatus: "pending",
    orderStatus: "pending",
    deliveryStatus: "unassigned",
    assignedRiderId: "",
    assignedRiderName: "",
    assignedRiderPhone: "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return orderNumber;
}

export async function getUserOrders(userId: string) {
  // No orderBy — avoids composite index requirement. Sort client-side.
  const ordersQuery = query(ordersCollection(), where("userId", "==", userId));
  const snapshot = await getDocs(ordersQuery);
  trackFirestoreRead("orders getDocs user", { userId });
  const orders = snapshot.docs.map(mapOrder);
  return orders.sort((a, b) => {
    const at = a.createdAt && typeof a.createdAt === "object" && "toDate" in a.createdAt ? (a.createdAt as { toDate: () => Date }).toDate().getTime() : 0;
    const bt = b.createdAt && typeof b.createdAt === "object" && "toDate" in b.createdAt ? (b.createdAt as { toDate: () => Date }).toDate().getTime() : 0;
    return bt - at;
  });
}

export async function getAllOrders() {
  const ordersQuery = query(ordersCollection(), orderBy("createdAt", "desc"));
  const snapshot = await getDocs(ordersQuery);
  trackFirestoreRead("orders getDocs all");
  return snapshot.docs.map(mapOrder);
}

export async function getOrderById(orderId: string) {
  const snapshot = await getDoc(orderDoc(orderId));
  trackFirestoreRead("orders getDoc by id", { orderId });
  if (!snapshot.exists()) {
    return null;
  }

  return mapOrder(snapshot);
}

export async function getOrdersByRider(riderId: string) {
  const riderOrdersQuery = query(ordersCollection(), where("assignedRiderId", "==", riderId));
  const snapshot = await getDocs(riderOrdersQuery);
  trackFirestoreRead("orders getDocs by rider", { riderId });
  const orders = snapshot.docs.map(mapOrder);
  return orders.sort((left, right) => {
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
}

export function subscribeToUserOrders(
  userId: string,
  callback: (orders: OrderRecord[]) => void,
  onError?: (error: Error) => void,
) {
  // Intentionally no orderBy — avoids requiring a composite Firestore index.
  // Results are sorted client-side by createdAt desc.
  const ordersQuery = query(ordersCollection(), where("userId", "==", userId));
  console.log("[orders] subscribing to user orders, userId:", userId);
  logFirestoreDebug("orders listener attached", { scope: "user", userId });
  return onSnapshot(
    ordersQuery,
    (snapshot) => {
      trackFirestoreRead("orders onSnapshot user", { userId, size: snapshot.size });
      console.log("[orders] snapshot received, docs:", snapshot.size, "userId:", userId);
      const orders = snapshot.docs.map(mapOrder);
      orders.sort((a, b) => {
        const at =
          a.createdAt && typeof a.createdAt === "object" && "toDate" in a.createdAt
            ? (a.createdAt as { toDate: () => Date }).toDate().getTime()
            : 0;
        const bt =
          b.createdAt && typeof b.createdAt === "object" && "toDate" in b.createdAt
            ? (b.createdAt as { toDate: () => Date }).toDate().getTime()
            : 0;
        return bt - at;
      });
      callback(orders);
    },
    (error) => {
      console.error("[orders] Firestore user orders listener error:", error.code, error.message);
      if (onError) {
        onError(error);
      }
    },
  );
}

export function subscribeToAllOrders(callback: (orders: OrderRecord[]) => void) {
  const ordersQuery = query(ordersCollection(), orderBy("createdAt", "desc"));
  logFirestoreDebug("orders listener attached", { scope: "all" });
  return onSnapshot(
    ordersQuery,
    (snapshot) => {
      trackFirestoreRead("orders onSnapshot all", { size: snapshot.size });
      callback(snapshot.docs.map(mapOrder));
    },
    (error) => {
      console.error("Firestore all orders listener error:", error);
    },
  );
}

export function subscribeToOrder(orderId: string, callback: (order: OrderRecord | null) => void) {
  logFirestoreDebug("orders listener attached", { scope: "single", orderId });
  return onSnapshot(
    orderDoc(orderId),
    (snapshot) => {
      trackFirestoreRead("orders onSnapshot single", { orderId, exists: snapshot.exists() });
      if (!snapshot.exists()) {
        callback(null);
        return;
      }

      callback(mapOrder(snapshot));
    },
    (error) => {
      console.error(`Firestore order listener error for ${orderId}:`, error);
    },
  );
}

export function subscribeToOrdersByRider(riderId: string, callback: (orders: OrderRecord[]) => void) {
  const riderOrdersQuery = query(ordersCollection(), where("assignedRiderId", "==", riderId));
  logFirestoreDebug("orders listener attached", { scope: "rider", riderId });
  return onSnapshot(
    riderOrdersQuery,
    (snapshot) => {
      trackFirestoreRead("orders onSnapshot rider", { riderId, size: snapshot.size });
      const orders = snapshot.docs.map(mapOrder);
      callback(
        orders.sort((left, right) => {
          const leftTime =
            left.createdAt && typeof left.createdAt === "object" && "toDate" in left.createdAt && typeof left.createdAt.toDate === "function"
              ? left.createdAt.toDate().getTime()
              : 0;
          const rightTime =
            right.createdAt && typeof right.createdAt === "object" && "toDate" in right.createdAt && typeof right.createdAt.toDate === "function"
              ? right.createdAt.toDate().getTime()
              : 0;
          return rightTime - leftTime;
        }),
      );
    },
    (error) => {
      console.error(`Firestore rider orders listener error for ${riderId}:`, error);
    },
  );
}

export async function updateOrderStatus(orderId: string, orderStatus: OrderStatus) {
  await updateDoc(orderDoc(orderId), {
    orderStatus,
    updatedAt: serverTimestamp(),
  });
}
