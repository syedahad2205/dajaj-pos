import { doc, runTransaction } from "firebase/firestore";
import { firestore } from "./firebase";

/**
 * Atomically increments the global order counter and returns the next order number.
 * Uses Firestore transactions to ensure uniqueness even under concurrent access.
 * The counter starts above 1000 as per requirements.
 */
export async function getNextOrderNumber(): Promise<number> {
  const counterRef = doc(firestore, "counters", "orders");

  return runTransaction(firestore, async (transaction) => {
    const counterDoc = await transaction.get(counterRef);
    const counterData = counterDoc.data() as { value?: number; current?: number } | undefined;
    // Use 'value' field (existing convention in orderService), fallback to 'current', default to 1000
    const current = counterData?.value ?? counterData?.current ?? 1000;
    const next = current + 1;

    transaction.set(counterRef, { value: next }, { merge: true });
    return next;
  });
}
