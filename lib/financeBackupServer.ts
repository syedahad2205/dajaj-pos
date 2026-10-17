import { DocumentReference, GeoPoint, Timestamp, type Firestore } from "firebase-admin/firestore";
import {
  Bytes as ClientBytes,
  DocumentReference as ClientDocumentReference,
  GeoPoint as ClientGeoPoint,
  Timestamp as ClientTimestamp,
} from "firebase/firestore";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { requireAdminCaller } from "@/lib/financeRouteAuth";
import { BACKUP_COLLECTION_NAMES, isoToTimestampParts, isPlainWireObject, timestampToIso, wireTag, type WireData, type WireValue } from "@/lib/financeBackup";

/**
 * Backup/restore runs on the Admin SDK: a restore has to rewrite collections
 * the client rules deliberately make append-only (fin_audit_logs) or
 * Finance-Manager-restricted. Every route therefore verifies the caller is an
 * Admin first, using the same check as the other Admin-only finance routes.
 */
export async function requireBackupAdmin(request: Request): Promise<{ userId: string; userName: string }> {
  const { cleanup, firestore, userId, userEmail } = await getAuthenticatedFirestoreForRequest(request);
  try {
    await requireAdminCaller(firestore, userId);
    return { userId, userName: userEmail ?? "Unknown" };
  } finally {
    await cleanup();
  }
}

export function assertBackupCollection(name: unknown): string {
  if (typeof name !== "string" || !BACKUP_COLLECTION_NAMES.has(name)) {
    throw new Error(`"${String(name)}" is not a finance collection that can be backed up or restored.`);
  }
  return name;
}

export function assertDocId(id: unknown): string {
  if (typeof id !== "string" || id.length === 0 || id.length > 1500 || id.includes("/") || id === "." || id === ".." || /^__.*__$/.test(id)) {
    throw new Error(`Invalid document id "${String(id)}".`);
  }
  return id;
}

/** Converts a document read by either the Admin SDK or the client SDK into wire JSON. */
export function toWire(value: unknown): WireValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Timestamp || value instanceof ClientTimestamp) return { __ts: timestampToIso(value.seconds, value.nanoseconds) };
  if (value instanceof GeoPoint || value instanceof ClientGeoPoint) return { __geo: [value.latitude, value.longitude] };
  if (value instanceof DocumentReference || value instanceof ClientDocumentReference) return { __ref: value.path };
  if (value instanceof ClientBytes) return { __bytes: value.toBase64() };
  if (value instanceof Uint8Array) return { __bytes: Buffer.from(value).toString("base64") };
  if (Array.isArray(value)) return value.map(toWire);
  if (typeof value === "object") {
    const out: { [key: string]: WireValue } = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = toWire(v);
    return out;
  }
  throw new Error(`Unsupported Firestore value of type ${typeof value}.`);
}

export function fromWire(value: WireValue, db: Firestore): unknown {
  if (Array.isArray(value)) return value.map((v) => fromWire(v, db));
  if (!isPlainWireObject(value)) return value;
  switch (wireTag(value)) {
    case "__ts": {
      const parts = typeof value.__ts === "string" ? isoToTimestampParts(value.__ts) : null;
      if (!parts) throw new Error(`Invalid timestamp ${JSON.stringify(value.__ts)}.`);
      return new Timestamp(parts.seconds, parts.nanoseconds);
    }
    case "__geo": {
      const [lat, lng] = Array.isArray(value.__geo) ? value.__geo : [];
      if (typeof lat !== "number" || typeof lng !== "number") throw new Error("Invalid geo point.");
      return new GeoPoint(lat, lng);
    }
    case "__ref":
      if (typeof value.__ref !== "string") throw new Error("Invalid document reference.");
      return db.doc(value.__ref);
    case "__bytes":
      if (typeof value.__bytes !== "string") throw new Error("Invalid bytes value.");
      return Buffer.from(value.__bytes, "base64");
    default: {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = fromWire(v, db);
      return out;
    }
  }
}

export function docFromWire(data: unknown, db: Firestore): Record<string, unknown> {
  if (!isPlainWireObject(data as WireValue)) throw new Error("Each document must be an object.");
  return fromWire(data as WireData, db) as Record<string, unknown>;
}
