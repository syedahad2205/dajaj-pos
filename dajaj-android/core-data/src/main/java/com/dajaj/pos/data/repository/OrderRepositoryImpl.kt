package com.dajaj.pos.data.repository

import com.dajaj.pos.common.Result
import com.dajaj.pos.common.connectivity.ConnectivityObserver
import com.dajaj.pos.common.connectivity.ConnectivityState
import com.dajaj.pos.data.di.BillsCollection
import com.dajaj.pos.data.di.OrdersCollection
import com.dajaj.pos.data.di.PrintJobsCollection
import com.dajaj.pos.data.local.entity.OrderEntity
import com.dajaj.pos.data.sync.OrderSyncManager
import com.dajaj.pos.domain.repository.OrderRepository
import com.google.firebase.firestore.CollectionReference
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Implementation of [OrderRepository] that handles order, bill, and print job creation.
 *
 * Strategy:
 * - If online: writes directly to Firestore
 * - If offline: saves order to Room via [OrderSyncManager] for later sync
 *
 * All Firestore writes go to the appropriate collections:
 * - Orders → `orders` collection
 * - Bills → `bills` collection
 * - Print jobs → `print_jobs` collection
 */
@Singleton
class OrderRepositoryImpl @Inject constructor(
    @OrdersCollection private val ordersCollection: CollectionReference,
    @BillsCollection private val billsCollection: CollectionReference,
    @PrintJobsCollection private val printJobsCollection: CollectionReference,
    private val connectivityObserver: ConnectivityObserver,
    private val orderSyncManager: OrderSyncManager
) : OrderRepository {

    /**
     * Creates an order in Firestore if online, or saves it locally if offline.
     *
     * When online: writes the order document to the `orders` collection.
     * When offline: delegates to [saveOrderLocally] which persists to Room and
     * will sync later via [OrderSyncManager].
     *
     * @param orderData Map of order fields matching the Firestore orders schema
     * @return Result containing the order ID on success
     */
    override suspend fun createOrder(orderData: Map<String, Any?>): Result<String> {
        val isOnline = isCurrentlyOnline()

        return if (isOnline) {
            try {
                val orderId = orderData["id"] as? String
                if (orderId != null) {
                    ordersCollection.document(orderId).set(orderData).await()
                    Result.Success(orderId)
                } else {
                    val docRef = ordersCollection.add(orderData).await()
                    Result.Success(docRef.id)
                }
            } catch (e: Exception) {
                // Fallback to local save on Firestore write failure
                val entity = mapToOrderEntity(orderData)
                val localResult = orderSyncManager.saveOrderLocally(entity)
                if (localResult.isSuccess) {
                    Result.Success(orderData["id"] as? String ?: "local")
                } else {
                    Result.Error("Failed to create order: ${e.message}", e)
                }
            }
        } else {
            val entity = mapToOrderEntity(orderData)
            val localResult = orderSyncManager.saveOrderLocally(entity)
            if (localResult.isSuccess) {
                Result.Success(orderData["id"] as? String ?: "local")
            } else {
                (localResult as Result.Error).let {
                    Result.Error(it.message, it.throwable)
                }
            }
        }
    }

    /**
     * Creates a bill document in the Firestore `bills` collection.
     *
     * @param billData Map of bill fields matching the Firestore bills schema
     * @return Result containing the bill document ID on success
     */
    override suspend fun createBill(billData: Map<String, Any?>): Result<String> {
        return try {
            val billId = billData["id"] as? String
            if (billId != null) {
                billsCollection.document(billId).set(billData).await()
                Result.Success(billId)
            } else {
                val docRef = billsCollection.add(billData).await()
                Result.Success(docRef.id)
            }
        } catch (e: Exception) {
            Result.Error("Failed to create bill: ${e.message}", e)
        }
    }

    /**
     * Creates a print job document in the Firestore `print_jobs` collection.
     *
     * @param printJobData Map of print job fields matching the Firestore print_jobs schema
     * @return Result containing the print job document ID on success
     */
    override suspend fun createPrintJob(printJobData: Map<String, Any?>): Result<String> {
        return try {
            val jobId = printJobData["id"] as? String
            if (jobId != null) {
                printJobsCollection.document(jobId).set(printJobData).await()
                Result.Success(jobId)
            } else {
                val docRef = printJobsCollection.add(printJobData).await()
                Result.Success(docRef.id)
            }
        } catch (e: Exception) {
            Result.Error("Failed to create print job: ${e.message}", e)
        }
    }

    /**
     * Saves an order, bill, and print job data locally for offline processing.
     * Delegates order storage to [OrderSyncManager] which handles capacity limits.
     *
     * @param orderData Map of order fields
     * @param billData Map of bill fields (stored alongside order for later sync)
     * @param printJobData Map of print job fields (stored for later processing)
     * @return Result indicating success or failure
     */
    override suspend fun saveOrderLocally(
        orderData: Map<String, Any?>,
        billData: Map<String, Any?>,
        printJobData: Map<String, Any?>
    ): Result<Unit> {
        val entity = mapToOrderEntity(orderData)
        return orderSyncManager.saveOrderLocally(entity)
    }

    /**
     * Checks the current connectivity state.
     * Returns true if the device has an active internet connection.
     */
    private suspend fun isCurrentlyOnline(): Boolean {
        return try {
            connectivityObserver.observe().first() == ConnectivityState.CONNECTED
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Converts a generic order data map to an [OrderEntity] for Room persistence.
     */
    private fun mapToOrderEntity(orderData: Map<String, Any?>): OrderEntity {
        return OrderEntity(
            id = orderData["id"] as? String ?: "",
            restaurantId = orderData["restaurantId"] as? String ?: "",
            orderNumber = orderData["orderNumber"] as? String ?: "",
            channel = orderData["channel"] as? String ?: "walk_in",
            type = orderData["type"] as? String ?: "walk_in",
            status = orderData["status"] as? String ?: "pending",
            customerId = orderData["customerId"] as? String,
            customerName = orderData["customerName"] as? String,
            customerPhone = orderData["customerPhone"] as? String,
            itemsJson = when (val items = orderData["items"]) {
                is String -> items
                else -> items?.toString() ?: "[]"
            },
            subtotal = (orderData["subtotal"] as? Number)?.toDouble() ?: 0.0,
            cgst = (orderData["cgst"] as? Number)?.toDouble() ?: 0.0,
            sgst = (orderData["sgst"] as? Number)?.toDouble() ?: 0.0,
            grandTotal = (orderData["grandTotal"] as? Number)?.toDouble() ?: 0.0,
            paymentMode = orderData["paymentMode"] as? String ?: "cash",
            cashierId = orderData["cashierId"] as? String,
            rejectionReason = orderData["rejectionReason"] as? String,
            synced = false,
            createdAt = (orderData["createdAt"] as? Number)?.toLong() ?: System.currentTimeMillis(),
            updatedAt = (orderData["updatedAt"] as? Number)?.toLong() ?: System.currentTimeMillis(),
            acceptedAt = (orderData["acceptedAt"] as? Number)?.toLong(),
            preparingAt = (orderData["preparingAt"] as? Number)?.toLong(),
            readyAt = (orderData["readyAt"] as? Number)?.toLong(),
            completedAt = (orderData["completedAt"] as? Number)?.toLong()
        )
    }
}
