package com.dajaj.pos.data.sync

import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.dajaj.pos.common.Constants
import com.dajaj.pos.common.Result
import com.dajaj.pos.common.connectivity.ConnectivityObserver
import com.dajaj.pos.common.connectivity.ConnectivityState
import com.dajaj.pos.data.local.dao.OrderDao
import com.dajaj.pos.data.local.entity.OrderEntity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.scan
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Manages offline order synchronization between Room and Firestore.
 *
 * Responsibilities:
 * - Observes connectivity state and triggers sync on OFFLINE → ONLINE transitions
 * - Enqueues [OrderSyncWorker] via WorkManager with exponential backoff (base 5s, max 5 retries)
 * - Enforces the local offline queue capacity (max [Constants.OFFLINE_ORDER_QUEUE_MAX] = 500 orders)
 *
 * WorkManager handles constraints (requires network connectivity) and backoff policy
 * automatically, ensuring orders sync within 60 seconds of connectivity being restored.
 */
@Singleton
class OrderSyncManager @Inject constructor(
    private val workManager: WorkManager,
    private val connectivityObserver: ConnectivityObserver,
    private val orderDao: OrderDao
) {

    companion object {
        /** Base backoff interval for exponential retry (5 seconds). */
        private const val BACKOFF_DELAY_SECONDS = 5L
    }

    /**
     * Starts observing connectivity changes. When a transition from DISCONNECTED to CONNECTED
     * is detected, enqueues the [OrderSyncWorker] to synchronize pending local orders.
     *
     * Should be called once during application initialization (e.g., from Application.onCreate).
     *
     * @param scope The [CoroutineScope] to use for collecting connectivity flow (application scope)
     */
    fun startObserving(scope: CoroutineScope) {
        connectivityObserver.observe()
            .scan<ConnectivityState, Pair<ConnectivityState?, ConnectivityState>>(
                Pair(null, ConnectivityState.DISCONNECTED)
            ) { (_, previous), current ->
                Pair(previous, current)
            }
            .onEach { (previous, current) ->
                // Trigger sync on OFFLINE → ONLINE transition
                if (previous == ConnectivityState.DISCONNECTED &&
                    current == ConnectivityState.CONNECTED
                ) {
                    enqueueSync()
                }
            }
            .launchIn(scope)
    }

    /**
     * Enqueues a one-time [OrderSyncWorker] work request with:
     * - Network constraint: requires CONNECTED
     * - Exponential backoff: base 5 seconds
     * - Maximum retries: 5 (controlled by [Constants.SYNC_RETRY_MAX] via WorkManager run attempt count)
     *
     * Uses [ExistingWorkPolicy.REPLACE] to avoid stacking duplicate sync requests.
     */
    fun enqueueSync() {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val syncRequest = OneTimeWorkRequestBuilder<OrderSyncWorker>()
            .setConstraints(constraints)
            .setBackoffCriteria(
                BackoffPolicy.EXPONENTIAL,
                BACKOFF_DELAY_SECONDS,
                TimeUnit.SECONDS
            )
            .build()

        workManager.enqueueUniqueWork(
            OrderSyncWorker.WORK_NAME,
            ExistingWorkPolicy.REPLACE,
            syncRequest
        )
    }

    /**
     * Saves an order locally to Room for offline processing.
     * Enforces the maximum offline queue size of [Constants.OFFLINE_ORDER_QUEUE_MAX] (500).
     *
     * @param orderEntity The order entity to persist locally
     * @return [Result.Success] if the order was saved, [Result.Error] if the queue is full
     */
    suspend fun saveOrderLocally(orderEntity: OrderEntity): Result<Unit> {
        val currentCount = orderDao.getUnsyncedCount()
        if (currentCount >= Constants.OFFLINE_ORDER_QUEUE_MAX) {
            return Result.Error(
                "Offline order queue is full ($currentCount/${Constants.OFFLINE_ORDER_QUEUE_MAX}). " +
                    "Cannot accept more orders until connectivity is restored."
            )
        }

        return try {
            orderDao.insert(orderEntity)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error("Failed to save order locally: ${e.message}", e)
        }
    }
}
