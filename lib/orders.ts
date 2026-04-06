import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import type { Address } from "@/lib/addresses";
import type { CartItem } from "@/components/cart/CartProvider";
import type { PaymentMethodId } from "@/lib/paymentMethods";

export interface Order {
  id: string;
  userId: string;
  items: CartItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  address: Address;
  paymentMethod: PaymentMethodId;
  status: "pending" | "confirmed" | "preparing" | "out_for_delivery" | "delivered" | "cancelled";
  createdAt?: unknown;
}

async function getNextOrderId() {
  const counterRef = doc(firestore, "counters", "orders");

  return runTransaction(firestore, async (transaction) => {
    const counterDoc = await transaction.get(counterRef);
    const counterData = counterDoc.data() as { value?: number; current?: number } | undefined;
    const current = counterData?.value ?? counterData?.current ?? 1000;
    const next = current + 1;

    transaction.set(counterRef, { value: next }, { merge: true });
    return String(next);
  });
}

export async function createOrder(input: Omit<Order, "id" | "createdAt" | "status">) {
  const orderId = await getNextOrderId();
  await setDoc(doc(collection(firestore, "orders"), orderId), {
    ...input,
    id: orderId,
    status: "pending",
    createdAt: serverTimestamp(),
  });

  return orderId;
}
