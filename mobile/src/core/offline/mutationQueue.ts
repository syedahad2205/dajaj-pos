/**
 * MMKV-backed offline mutation queue (design §7.1, Requirement 10.3–10.10).
 *
 * Persisted as a single JSON array under one MMKV key.
 * Read synchronously on app start — no async wait before queue state is available.
 * Written synchronously on every enqueue/dequeue so app kill/crash never loses a queued item.
 *
 * Ordering constraint (Requirement 10.6, design §7.2):
 *   closeDailyClosing mutations are always appended AFTER any other pending/failed
 *   mutations for the same date — never reordered ahead.
 */
import { createSafeStorage } from '@/core/storage/safeStorage';
import { generateIdempotencyKey } from '@/core/offline/idempotency';
import { logger } from '@/core/logging/logger';

export const storage = createSafeStorage({ id: 'dajaj-finance-offline-queue' });

const QUEUE_KEY = 'mutation_queue';

// ─── Types ────────────────────────────────────────────────────────────────────

export type MutationOperation =
  | 'addExpense'
  | 'addExpenses'
  | 'removeExpense'
  | 'addDeposit'
  | 'removeDeposit'
  | 'updateSales'
  | 'setOpeningCash'
  | 'closeDailyClosing';

export type MutationStatus = 'pending' | 'syncing' | 'failed';

export interface QueuedMutation<TPayload = unknown> {
  /** Idempotency key — generated once at enqueue, never regenerated on retry. */
  id: string;
  module: 'daily-closing';
  operation: MutationOperation;
  /** The fin_daily_closing document date this mutation targets. */
  targetDate: string;
  payload: TPayload;
  /** ISO 8601 client clock at enqueue — sent on every replay, never regenerated (Req 10.4). */
  deviceTime: string;
  /** Client epoch ms — queue bookkeeping, distinct from deviceTime (Req 10.3). */
  createdAt: number;
  deviceId: string;
  clientVersion: string;
  retryCount: number;
  createdOffline: boolean;
  status: MutationStatus;
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

function readQueue(): QueuedMutation[] {
  const raw = storage.getString(QUEUE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as QueuedMutation[];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedMutation[]): void {
  storage.set(QUEUE_KEY, JSON.stringify(queue));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Read the current queue synchronously. */
export function getQueue(): QueuedMutation[] {
  return readQueue();
}

/** Enqueue a mutation. Enforces close-last ordering for the same targetDate. */
export function enqueue<TPayload>(
  operation: MutationOperation,
  targetDate: string,
  payload: TPayload,
  options: {
    deviceId: string;
    clientVersion: string;
    isOffline: boolean;
  },
): QueuedMutation<TPayload> {
  const queue = readQueue();

  const mutation: QueuedMutation<TPayload> = {
    id: generateIdempotencyKey(),
    module: 'daily-closing',
    operation,
    targetDate,
    payload,
    deviceTime: new Date().toISOString(),
    createdAt: Date.now(),
    deviceId: options.deviceId,
    clientVersion: options.clientVersion,
    retryCount: 0,
    createdOffline: options.isOffline,
    status: 'pending',
  };

  // Ordering constraint: closeDailyClosing must always come after any other
  // pending/failed mutations for the same date (Requirement 10.6, design §7.2).
  if (operation === 'closeDailyClosing') {
    // Find the last non-close mutation for this date (or end of array if none)
    let insertIdx = queue.length;
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].targetDate === targetDate && queue[i].operation !== 'closeDailyClosing') {
        insertIdx = i + 1;
        break;
      }
    }
    queue.splice(insertIdx, 0, mutation);
  } else {
    // Normal mutations: append at the end, but before any existing close for the same date
    let insertIdx = queue.length;
    for (let i = 0; i < queue.length; i++) {
      if (queue[i].targetDate === targetDate && queue[i].operation === 'closeDailyClosing') {
        insertIdx = i;
        break;
      }
    }
    queue.splice(insertIdx, 0, mutation);
  }

  writeQueue(queue);
  logger.queue.enqueued(mutation.id, operation, targetDate, options.isOffline);
  return mutation;
}

/** Remove a mutation from the queue by idempotency key. */
export function dequeue(id: string): void {
  const queue = readQueue();
  const item = queue.find(m => m.id === id);
  const updated = queue.filter(m => m.id !== id);
  writeQueue(updated);
  if (item) logger.queue.dequeued(id, item.operation);
}

/** Update a mutation's status and retryCount in-place. */
export function updateMutation(id: string, updates: Partial<Pick<QueuedMutation, 'status' | 'retryCount'>>): void {
  const queue = readQueue().map(m => (m.id === id ? { ...m, ...updates } : m));
  writeQueue(queue);
}

/** Mark all pending/syncing mutations for a date as failed (e.g. on lock-conflict). */
export function markDateFailed(targetDate: string, fromIndex: number): void {
  const queue = readQueue();
  let idx = 0;
  const updated = queue.map(m => {
    if (m.targetDate === targetDate && m.status !== 'failed') {
      if (idx >= fromIndex) {
        idx++;
        return { ...m, status: 'failed' as MutationStatus };
      }
      idx++;
    }
    return m;
  });
  writeQueue(updated);
}

/** Clear the entire queue (used on logout). */
export function clearQueue(): void {
  storage.delete(QUEUE_KEY);
  logger.queue.cleared();
}

/** All distinct dates that have queued mutations, for per-date parallel replay. */
export function getQueuedDates(): string[] {
  const queue = readQueue();
  return [...new Set(queue.map(m => m.targetDate))];
}

/** Get all queued mutations for a specific date, in queue order. */
export function getQueueForDate(targetDate: string): QueuedMutation[] {
  return readQueue().filter(m => m.targetDate === targetDate);
}

/** Build the API route path for a queued mutation. */
export function buildMutationPath(mutation: QueuedMutation): { path: string; method: 'POST' | 'PATCH' | 'DELETE' } {
  const base = `/finance/closing/${mutation.targetDate}`;
  const payload = mutation.payload as Record<string, unknown>;

    switch (mutation.operation) {
      case 'addExpense':
      case 'addExpenses':
        return { path: `${base}/expenses`, method: 'POST' };
    case 'removeExpense':
      return { path: `${base}/expenses/${payload.entryId as string}`, method: 'DELETE' };
    case 'addDeposit':
      return { path: `${base}/deposits`, method: 'POST' };
    case 'removeDeposit':
      return { path: `${base}/deposits/${payload.entryId as string}`, method: 'DELETE' };
    case 'updateSales':
      return { path: `${base}/sales`, method: 'PATCH' };
    case 'setOpeningCash':
      return { path: `${base}/opening-cash`, method: 'PATCH' };
    case 'closeDailyClosing':
      return { path: base, method: 'PATCH' };
  }
}
