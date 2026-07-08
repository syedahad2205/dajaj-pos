/**
 * FIFO-per-date offline mutation replay engine (design §8, Requirement 11.1–11.6).
 *
 * runAll() is triggered by three sources (§8.1):
 *   1. NetInfo online-transition (within 5s)
 *   2. Manual "Sync Now" button in Settings
 *   3. AppState foreground-return
 *
 * For each distinct targetDate in the queue, mutations are replayed strictly
 * FIFO. Different dates are processed in parallel. Within a date:
 *   - success    → dequeue, cache server's returning closing via setQueryData
 *   - lock/validation failure → mark this + all later items for that date "failed", stop that date
 *   - transient failure → auto-retry up to 3 times (retryCount < 3), then mark "failed"
 */
import type { QueryClient } from '@tanstack/react-query';
import { apiCall } from '@/core/api/apiClient';
import {
  getQueuedDates,
  getQueueForDate,
  dequeue,
  updateMutation,
  buildMutationPath,
  type QueuedMutation,
} from '@/core/offline/mutationQueue';
import { useConnectivityStore } from '@/core/connectivity/useConnectivityStore';
import { logger } from '@/core/logging/logger';

let queryClient: QueryClient | null = null;
let getIdToken: (() => Promise<string | null>) | null = null;

/** Must be called once during app init with the TanStack Query client and an ID token getter. */
export function initQueueProcessor(
  qc: QueryClient,
  tokenGetter: () => Promise<string | null>,
): void {
  queryClient = qc;
  getIdToken = tokenGetter;
}

// Transient errors are network/infrastructure failures; lock-conflict errors are definitive.
function isDefinitiveFailure(message: string): boolean {
  return (
    /locked|already closed|lock/i.test(message) ||
    /locked.*reopen/i.test(message) ||
    /not found/i.test(message)
  );
}

const MAX_AUTO_RETRIES = 3;

/** Replay all queued mutations for a single date, strictly FIFO. */
async function replayDateQueue(targetDate: string, idToken: string): Promise<void> {
  const store = useConnectivityStore.getState();
  const initialItems = getQueueForDate(targetDate);
  logger.sync.dateStarted(targetDate, initialItems.length);

  let dequeued = 0;

  // Process mutations one at a time for this date
  // Re-read queue on each iteration — queue may change between retries
  let continueDate = true;
  while (continueDate) {
    const mutations = getQueueForDate(targetDate);
    const next = mutations.find(m => m.status !== 'failed');
    if (!next) break; // All done or all failed for this date

    updateMutation(next.id, { status: 'syncing' });

    const { path, method } = buildMutationPath(next);
    const payload = next.payload as Record<string, unknown>;

    try {
      const result = await apiCall({
        method,
        path,
        body: method !== 'DELETE' ? payload : undefined,
        idToken,
        idempotencyKey: next.id,
      });

      if (result.success) {
        // Cache the authoritative server response (Requirement 6.2)
        if (queryClient) {
          queryClient.setQueryData(
            ['dailyClosing', targetDate],
            result.closing,
          );
        }
        dequeue(next.id);
        logger.sync.itemSuccess(next.id, next.operation, targetDate);
        dequeued++;
        // Continue to next item for this date
      } else {
        // API returned success: false
        if (isDefinitiveFailure(result.message)) {
          // Mark this and all later queued items for this date as failed (Requirement 11.5)
          const remaining = getQueueForDate(targetDate);
          for (const m of remaining) {
            if (m.status !== 'failed') {
              updateMutation(m.id, { status: 'failed' });
            }
          }
          logger.sync.itemFailed(next.id, next.operation, targetDate, result.message, next.retryCount);
          logger.queue.dateFailed(targetDate, result.message);
          continueDate = false;
        } else {
          // Transient / unexpected failure — retry logic
          const newRetryCount = next.retryCount + 1;
          if (newRetryCount < MAX_AUTO_RETRIES) {
            updateMutation(next.id, { status: 'pending', retryCount: newRetryCount });
            logger.sync.itemRetrying(next.id, next.operation, newRetryCount);
            // Brief pause before retry
            await new Promise(r => setTimeout(r, 500 * newRetryCount));
          } else {
            // Exhausted retries — mark failed, stop this date (Requirement 11.6)
            const remaining = getQueueForDate(targetDate);
            for (const m of remaining) {
              if (m.status !== 'failed') {
                updateMutation(m.id, { status: 'failed' });
              }
            }
            logger.sync.itemFailed(next.id, next.operation, targetDate, result.message, next.retryCount);
            logger.queue.dateFailed(targetDate, `Max retries exhausted: ${result.message}`);
            continueDate = false;
          }
        }
      }
    } catch (_err) {
      // Network-level failure
      const newRetryCount = next.retryCount + 1;
      if (newRetryCount < MAX_AUTO_RETRIES) {
        updateMutation(next.id, { status: 'pending', retryCount: newRetryCount });
        logger.sync.itemRetrying(next.id, next.operation, newRetryCount);
        await new Promise(r => setTimeout(r, 500 * newRetryCount));
      } else {
        const remaining = getQueueForDate(targetDate);
        for (const m of remaining) {
          if (m.status !== 'failed') {
            updateMutation(m.id, { status: 'failed' });
          }
        }
        const errMsg = _err instanceof Error ? _err.message : String(_err);
        logger.sync.itemFailed(next.id, next.operation, targetDate, errMsg, next.retryCount);
        logger.queue.dateFailed(targetDate, `Network failure: ${errMsg}`);
        continueDate = false;
      }
    }
  }

  // Recompute sync status after this date's replay
  const allQueued = getQueuedDates().flatMap(d => getQueueForDate(d));
  const hasPending = allQueued.some(m => m.status === 'pending' || m.status === 'syncing');
  const hasFailed = allQueued.some(m => m.status === 'failed');
  store.recomputeSyncStatus(hasPending, hasFailed);

  logger.debug('sync', `Date ${targetDate} replay finished`, { dequeued });
}

/** Run all queued mutations — all dates in parallel, each date strictly FIFO. */
export async function runAll(): Promise<void> {
  if (!getIdToken) return;

  const idToken = await getIdToken();
  if (!idToken) return;

  const dates = getQueuedDates();
  if (dates.length === 0) {
    useConnectivityStore.getState().recomputeSyncStatus(false, false);
    return;
  }

  logger.sync.started(dates.length);

  // Update UI to pending-sync while replay is running
  useConnectivityStore.getState().recomputeSyncStatus(true, false);

  // Replay each date's queue in parallel (Requirement 11.1)
  await Promise.all(dates.map(date => replayDateQueue(date, idToken)));

  // Count remaining failed items for completion log
  const remaining = dates.flatMap(d => getQueueForDate(d));
  const failedCount = remaining.filter(m => m.status === 'failed').length;
  if (failedCount > 0) {
    logger.sync.failed(`${failedCount} item(s) remain failed after sync`);
  } else {
    logger.sync.completed(0); // dequeued count tracked per-date above
  }
}
