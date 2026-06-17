package com.dajaj.pos.domain.repository

import com.dajaj.pos.common.Result
import com.dajaj.pos.domain.model.Order
import kotlinx.coroutines.flow.Flow

/**
 * Domain-layer interface for offline data synchronization.
 *
 * Ensures zero data loss during connectivity interruptions by queuing
 * orders and print jobs locally in Room Database and syncing them to
 * Firestore when connectivity is restored.
 *
 * Limits:
 * - Offline orders: max 500 in Room Database
 * - Offline print jobs: max 500 in Room Database
 * - Sync on reconnect: chronological order, within 60 seconds
 * - Sync retry: 5 attempts, exponential backoff (5s, 10s, 20s, 40s, 80s)
 */
interface OfflineSyncManager {

    /**
     * Queues an order for later synchronization to Firestore.
     * The order is persisted locally in Room with its original createdAt timestamp.
     * Fails if the offline queue has reached its capacity limit (500 orders).
     *
     * @param order The order to queue for sync
     * @return Result indicating success or failure (e.g., capacity exceeded)
     */
    suspend fun queueOrder(order: Order): Result<Unit>

    /**
     * Synchronizes all pending (queued) orders to Firestore.
     * Orders are synced in chronological order (oldest first).
     * Retries up to 5 times with exponential backoff on failure.
     *
     * @return Result containing a sync report with success/failure counts
     */
    suspend fun syncPendingOrders(): Result<SyncReport>

    /**
     * Observes the count of orders currently queued for sync.
     * Used to display the offline queue indicator in the UI.
     */
    fun getQueuedOrderCount(): Flow<Int>

    /**
     * Observes the count of print jobs currently queued for sync.
     * Used to display the offline queue indicator in the UI.
     */
    fun getQueuedPrintJobCount(): Flow<Int>
}

/**
 * Report summarizing the results of an offline sync operation.
 */
data class SyncReport(
    /** Number of items successfully synced to Firestore. */
    val successCount: Int,

    /** Number of items that failed to sync. */
    val failureCount: Int,

    /** Total number of items that were attempted. */
    val totalAttempted: Int
)
