package com.dajaj.pos.data.sync

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.dajaj.pos.data.di.OrdersCollection
import com.dajaj.pos.data.local.dao.OrderDao
import com.dajaj.pos.data.local.entity.OrderEntity
import com.google.firebase.firestore.CollectionReference
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.tasks.await

/**
 * WorkManager [CoroutineWorker] that synchronizes locally cached orders to Firestore.
 *
 * Reads all unsynced orders from Room (synced=false) sorted by createdAt ASC,
 * writes each to the Firestore `orders` collection, and marks them as synced on success.
 *
 * On failure, returns [Result.retry()] so WorkManager handles backoff via the
 * ExponentialBackoffPolicy configured in [OrderSyncManager].
 *
 * @see OrderSyncManager for work request configuration (backoff, constraints, retry limit)
 */
@HiltWorker
class OrderSyncWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted workerParams: WorkerParameters,
    private val orderDao: OrderDao,
    @OrdersCollection private val ordersCollection: CollectionReference
) : CoroutineWorker(appContext, workerParams) {

    companion object {
        const val WORK_NAME = "order_sync_worker"
    }

    override suspend fun doWork(): Result {
        // Respect maximum retry count (SYNC_RETRY_MAX = 5)
        if (runAttemptCount >= com.dajaj.pos.common.Constants.SYNC_RETRY_MAX) {
            return Result.failure()
        }

        return try {
            val unsyncedOrders = orderDao.getUnsyncedOrders().first()

            if (unsyncedOrders.isEmpty()) {
                return Result.success()
            }

            for (order in unsyncedOrders) {
                val firestoreData = mapOrderToFirestore(order)
                try {
                    ordersCollection.document(order.id).set(firestoreData).await()
                    orderDao.markSynced(order.id)
                } catch (e: Exception) {
                    // If any single order fails, retry the entire batch
                    return Result.retry()
                }
            }

            Result.success()
        } catch (e: Exception) {
            Result.retry()
        }
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
            "items" to order.itemsJson, // Stored as JSON string in Room
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
}
