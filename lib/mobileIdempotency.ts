import { doc, getDoc, setDoc, type Firestore, type Timestamp } from "firebase/firestore";
import type { FinanceDailyClosing } from "@/lib/finance";

/**
 * Shape of a mobile idempotency record stored in fin_mobile_idempotency/{key}.
 * Written once per mutation attempt (success or definitive failure) so that
 * re-submitted requests from a retrying offline queue return the original
 * result without re-executing the underlying service function.
 *
 * - `status: "succeeded"` → closingSnapshot holds the server's returned closing
 * - `status: "failed"`    → message holds the error that was surfaced to the client
 * - `deviceTime`          → ISO timestamp from the mobile device at enqueue time (informational only)
 * - `serverTime`          → ISO timestamp set by the API route when the record was written
 * - `createdAt`           → Firestore server timestamp for TTL/cleanup purposes
 */
export interface IdempotencyRecord {
  status: "succeeded" | "failed";
  closingSnapshot?: FinanceDailyClosing;
  message?: string;
  deviceTime?: string;
  serverTime: string;
  createdAt: Timestamp;
}

const COLLECTION = "fin_mobile_idempotency";

/**
 * Reads an idempotency record by key.
 * Returns null if no record exists for this key.
 *
 * @param key     - The idempotency key (stable UUID generated at enqueue time)
 * @param firestore - The Finance User's forwarded-identity Firestore client (never Admin SDK)
 */
export async function getIdempotencyRecord(
  key: string,
  firestore: Firestore,
): Promise<IdempotencyRecord | null> {
  const snap = await getDoc(doc(firestore, COLLECTION, key));
  if (!snap.exists()) return null;
  return snap.data() as IdempotencyRecord;
}

/**
 * Writes (or overwrites) an idempotency record for the given key.
 * Always a full overwrite — idempotency records are written exactly once
 * and never updated (mutation immutability).
 *
 * @param key     - The idempotency key
 * @param record  - The record to store
 * @param firestore - The Finance User's forwarded-identity Firestore client (never Admin SDK)
 */
export async function writeIdempotencyRecord(
  key: string,
  record: IdempotencyRecord,
  firestore: Firestore,
): Promise<void> {
  await setDoc(doc(firestore, COLLECTION, key), record);
}
