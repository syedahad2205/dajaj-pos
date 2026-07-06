import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit as fbLimit,
  orderBy,
  query,
  serverTimestamp,
  where,
  type DocumentData,
  type DocumentReference,
  type Firestore,
} from "firebase/firestore";
import { firestore as defaultFirestore } from "@/lib/firebase";
import type { FinanceAuditAction, FinanceAuditLog, FinanceAuditModule } from "@/lib/finance";

/**
 * Minimal structural type covering the one `.set(ref, data)` overload both
 * Firestore's `Transaction` and `WriteBatch` share. Typing against the full
 * union of those classes breaks TS overload resolution (each has multiple
 * `.set` overloads), so we narrow to exactly what this module needs.
 */
export interface FinanceAuditWriter {
  set(documentRef: DocumentReference<DocumentData>, data: DocumentData): unknown;
}

export function financeAuditLogsCollection(db: Firestore = defaultFirestore) {
  return collection(db, "fin_audit_logs");
}

export interface WriteFinanceAuditParams {
  module: FinanceAuditModule;
  entityId: string;
  entityLabel: string;
  action: FinanceAuditAction;
  userId: string;
  userName: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
}

/**
 * Appends a single audit log entry using an in-flight Firestore transaction
 * or batch, so the audit record is written atomically alongside the mutation
 * it describes — an audit trail that can fall out of sync with the write it
 * documents isn't worth having.
 */
export function writeFinanceAuditLog(
  writer: FinanceAuditWriter,
  db: Firestore,
  params: WriteFinanceAuditParams,
): void {
  const logRef = doc(financeAuditLogsCollection(db));
  writer.set(logRef, {
    module: params.module,
    entityId: params.entityId,
    entityLabel: params.entityLabel,
    action: params.action,
    userId: params.userId,
    userName: params.userName,
    oldValue: params.oldValue ?? null,
    newValue: params.newValue ?? null,
    reason: params.reason ?? null,
    timestamp: serverTimestamp(),
  });
}

/** Standalone (non-transactional) audit write — used for actions that aren't part of a larger atomic write. */
export async function logFinanceAudit(params: WriteFinanceAuditParams, db: Firestore = defaultFirestore): Promise<void> {
  await addDoc(financeAuditLogsCollection(db), {
    module: params.module,
    entityId: params.entityId,
    entityLabel: params.entityLabel,
    action: params.action,
    userId: params.userId,
    userName: params.userName,
    oldValue: params.oldValue ?? null,
    newValue: params.newValue ?? null,
    reason: params.reason ?? null,
    timestamp: serverTimestamp(),
  });
}

export interface FinanceAuditLogFilters {
  module?: FinanceAuditModule;
  entityId?: string;
  limitCount?: number;
}

export async function getFinanceAuditLogs(
  filters: FinanceAuditLogFilters = {},
  db: Firestore = defaultFirestore,
): Promise<FinanceAuditLog[]> {
  const constraints = [];
  if (filters.module) constraints.push(where("module", "==", filters.module));
  if (filters.entityId) constraints.push(where("entityId", "==", filters.entityId));
  constraints.push(orderBy("timestamp", "desc"));
  constraints.push(fbLimit(filters.limitCount ?? 200));

  const snapshot = await getDocs(query(financeAuditLogsCollection(db), ...constraints));
  return snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FinanceAuditLog, "id">) }));
}
