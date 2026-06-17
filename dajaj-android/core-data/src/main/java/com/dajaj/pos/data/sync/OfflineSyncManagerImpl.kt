package com.dajaj.pos.data.sync

import com.dajaj.pos.common.Constants
import com.dajaj.pos.common.Result
import com.dajaj.pos.data.di.OrdersCollection
import com.dajaj.pos.data.local.dao.OrderDao
import com.dajaj.pos.data.local.dao.PrintJobDao
import com.dajaj.pos.data.local.entity.OrderEntity
import com.dajaj.pos.domain.model.Order
import com.dajaj.pos.domain.repository.OfflineSyncManager
import com.dajaj.pos.domain.repository.SyncReport
import com.google.firebase.firestore.CollectionReference
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Data-layer implementation of [OfflineSyncManager].
 *
 * Ensures zero data loss during connectivity interruptions by:
 * - Persisting orders to Room Database with a 500-order capacity limit
 * - Syncing pending orders to Firestore in chronological order (oldest first)
 * - Retrying up to 5 times with exponential backoff (5s, 10s, 20s, 40s, 80s)
 * - Providing reactive counts for UI indicators
 *
 * Requirements: 12.5, 12.6
 */
@Singleton
class OfflineSyncManagerImpl @Inject constructor(
    private val orderDao: OrderDao,
    private val printJobDao: PrintJobDao,
    @OrdersCollection private val ordersCollection: CollectionReference
) : OfflineSyncManager {

    companion object {
        /** Base delay for exponential backoff (5 seconds). */
        private const val BACKOFF_BASE_DELAY_MS = 5_000L
    }

    /**
     * Queues an order for later synchronization to Firestore.
     * The order is persisted locally in Room with its original createdAt timestamp.
     * Fails if the offline queue has reached its capacity limit (500 orders).
     *
     * @param order The domain order to queue for sync
     * @return Result indicating success or failure (e.g., capacity exceeded)
     */
    override suspend fun queueOrder(order: Order): Result<Unit> {
        val currentCount = orderDao.getUnsyncedCount()
        if (currentCount >= Constants.OFFLINE_ORDER_QUEUE_MAX) {
            return Result.Error(
                "Offline order queue is full ($currentCount/${Constants.OFFLINE_ORDER_QUEUE_MAX}). " +
                    "Cannot accept more orders until connectivity is restored."
            )
        }

        return try {
            val entity = mapOrderToEntity(order)
            orderDao.insert(entity)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error("Failed to queue order locally: ${e.message}", e)
        }
    }

    /**
     * Synchronizes all pending (queued) orders to Firestore.
     * Orders are synced in chronological order (oldest first).
     * Retries up to 5 times with exponential backoff on failure per order.
     *
     * The entire sync operation should complete within 60 seconds of connectivity restoration.
     *
     * @return Result containing a sync report with success/failure counts
     */
    override suspend fun syncPendingOrders(): Result<SyncReport> {
        return try {
            val unsyncedOrders = orderDao.getUnsyncedOrders().first()

            if (unsyncedOrders.isEmpty()) {
                return Result.Success(SyncReport(successCount = 0, failureCount = 0, totalAttempted = 0))
            }

            var successCount = 0
            var failureCount = 0

            for (order in unsyncedOrders) {
                val synced = syncSingleOrderWithRetry(order)
                if (synced) {
                    successCount++
                } else {
                    failureCount++
                }
            }

            Result.Success(
                SyncReport(
                    successCount = successCount,
                    failureCount = failureCount,
                    totalAttempted = unsyncedOrders.size
                )
            )
        } catch (e: Exception) {
            Result.Error("Sync operation failed: ${e.message}", e)
        }
    }

    /**
     * Observes the count of orders currently queued for sync.
     * Used to display the offline queue indicator in the UI.
     */
    override fun getQueuedOrderCount(): Flow<Int> {
        return orderDao.observeUnsyncedCount()
    }

    /**
     * Observes the count of print jobs currently queued for sync.
     * Used to display the offline queue indicator in the UI.
     */
    override fun getQueuedPrintJobCount(): Flow<Int> {
        return printJobDao.observePendingCount()
    }

    /**
     * Attempts to sync a single order to Firestore with exponential backoff retry.
     * Retries up to [Constants.SYNC_RETRY_MAX] (5) times with delays: 5s, 10s, 20s, 40s, 80s.
     *
     * @return true if the order was successfully synced, false if all retries exhausted
     */
    private suspend fun syncSingleOrderWithRetry(order: OrderEntity): Boolean {
        repeat(Constants.SYNC_RETRY_MAX) { attempt ->
            try {
                val firestoreData = mapOrderToFirestore(order)
                ordersCollection.document(order.id).set(firestoreData).await()
                orderDao.markSynced(order.id)
                return true
            } catch (e: Exception) {
                if (attempt < Constants.SYNC_RETRY_MAX - 1) {
                    // Exponential backoff: 5s, 10s, 20s, 40s, 80s
                    val delayMs = BACKOFF_BASE_DELAY_MS * (1L shl attempt)
                    delay(delayMs)
                }
            }
        }
        return false
    }

    /**
     * Converts a domain [Order] to an [OrderEntity] for Room persistence.
     * Uses the domain model's built-in toFirestoreValue() methods for enum mapping.
     */
    private fun mapOrderToEntity(order: Order): OrderEntity {
        return OrderEntity(
            id = order.id,
            restaurantId = order.restaurantId,
            orderNumber = order.orderNumber,
            channel = order.channel.toFirestoreValue(),
            type = order.type.toFirestoreValue(),
            status = order.status.toFirestoreValue(),
            customerId = null,
            customerName = order.customerName,
            customerPhone = order.customerPhone,
            itemsJson = serializeItems(order),
            subtotal = order.subtotal,
            cgst = order.cgst,
            sgst = order.sgst,
            grandTotal = order.grandTotal,
            paymentMode = order.paymentMode.toFirestoreValue(),
            cashierId = order.cashierId,
            rejectionReason = order.rejectionReason,
            synced = false,
            createdAt = order.createdAt,
            updatedAt = order.createdAt,
            acceptedAt = order.acceptedAt,
            preparingAt = order.preparingAt,
            readyAt = order.readyAt,
            completedAt = order.completedAt
        )
    }

    /**
     * Converts an [OrderEntity] to a Firestore-compatible map matching the `orders` collection schema.
     */
    private fun mapOrderToFirestore(order: OrderEntity): Map<String, Any?> {
        return mapOf(
            "id" to order.id,
            "restaurantId" to order.restaurantId,
            "orderNumber" to order.orderNumber,
            "channel" to order.channel,
            "type" to order.type,
            "status" to order.status,
            "customerId" to order.customerId,
            "customerName" to order.customerName,
            "customerPhone" to order.customerPhone,
            "items" to order.itemsJson,
            "subtotal" to order.subtotal,
            "cgst" to order.cgst,
            "sgst" to order.sgst,
            "grandTotal" to order.grandTotal,
            "paymentMode" to order.paymentMode,
            "cashierId" to order.cashierId,
            "rejectionReason" to order.rejectionReason,
            "createdAt" to order.createdAt,
            "updatedAt" to order.updatedAt,
            "acceptedAt" to order.acceptedAt,
            "preparingAt" to order.preparingAt,
            "readyAt" to order.readyAt,
            "completedAt" to order.completedAt
        )
    }

    /**
     * Serializes order items to a JSON string for storage in Room.
     * In production, this would use a proper JSON library (Moshi/Gson).
     */
    private fun serializeItems(order: Order): String {
        val items = order.items.map { item ->
            """{"id":"${item.id}","name":"${item.name}","variantLabel":"${item.variantLabel ?: ""}","variantId":"${item.variantId ?: ""}","qty":${item.qty},"basePrice":${item.basePrice},"modifiers":[${
                item.modifiers.joinToString(",") { mod ->
                    """{"id":"${mod.id}","name":"${mod.name}","price":${mod.price},"groupName":"${mod.groupName}"}"""
                }
            }],"itemTotal":${item.itemTotal}}"""
        }
        return "[${items.joinToString(",")}]"
    }
}
