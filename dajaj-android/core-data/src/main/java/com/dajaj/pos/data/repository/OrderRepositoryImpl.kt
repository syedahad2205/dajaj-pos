package com.dajaj.pos.data.repository

import com.dajaj.pos.common.Result
import com.dajaj.pos.common.connectivity.ConnectivityObserver
import com.dajaj.pos.common.connectivity.ConnectivityState
import com.dajaj.pos.data.di.BillsCollection
import com.dajaj.pos.data.di.OrdersCollection
import com.dajaj.pos.data.di.PrintJobsCollection
import com.dajaj.pos.data.local.entity.OrderEntity
import com.dajaj.pos.data.sync.OrderSyncManager
import com.dajaj.pos.domain.model.OrderChannel
import com.dajaj.pos.domain.model.OrderStatus
import com.dajaj.pos.domain.repository.CreatedOrder
import com.dajaj.pos.domain.repository.NewOrder
import com.dajaj.pos.domain.repository.OrderRepository
import com.google.firebase.firestore.CollectionReference
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.tasks.await
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.atomic.AtomicInteger
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Implementation of [OrderRepository] that handles order, bill, and print job creation.
 *
 * Strategy:
 * - If online: writes directly to Firestore
 * - If offline: saves order to Room via [OrderSyncManager] for later sync
 */
@Singleton
class OrderRepositoryImpl @Inject constructor(
    @OrdersCollection private val ordersCollection: CollectionReference,
    @BillsCollection private val billsCollection: CollectionReference,
    @PrintJobsCollection private val printJobsCollection: CollectionReference,
    private val connectivityObserver: ConnectivityObserver,
    private val orderSyncManager: OrderSyncManager
) : OrderRepository {

    /** Daily sequential counter for generating human-readable order numbers. */
    private val dailyCounter = AtomicInteger(1)
    private var lastDateString: String = getCurrentDateString()

    // ── Typed overload (used by ConfirmOrderUseCase) ──────────────────────────

    override suspend fun createOrder(order: NewOrder): Result<CreatedOrder> {
        val orderNumber = generateOrderNumber()
        val orderData = order.toMap(orderNumber)

        return if (isCurrentlyOnline()) {
            try {
                val docRef = ordersCollection.add(orderData).await()
                Result.Success(CreatedOrder(id = docRef.id, orderNumber = orderNumber))
            } catch (e: Exception) {
                // Fallback to local storage on Firestore failure
                val entity = mapToOrderEntity(orderData)
                val localResult = orderSyncManager.saveOrderLocally(entity)
                if (localResult.isSuccess) {
                    Result.Success(CreatedOrder(id = "local", orderNumber = orderNumber))
                } else {
                    Result.Error("Failed to create order: ${e.message}", e)
                }
            }
        } else {
            val entity = mapToOrderEntity(orderData)
            val localResult = orderSyncManager.saveOrderLocally(entity)
            if (localResult.isSuccess) {
                Result.Success(CreatedOrder(id = "local", orderNumber = orderNumber))
            } else {
                (localResult as Result.Error).let { Result.Error(it.message, it.throwable) }
            }
        }
    }

    // ── Raw-map overloads (used by legacy use cases) ──────────────────────────

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
                (localResult as Result.Error).let { Result.Error(it.message, it.throwable) }
            }
        }
    }

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

    override suspend fun saveOrderLocally(
        orderData: Map<String, Any?>,
        billData: Map<String, Any?>,
        printJobData: Map<String, Any?>
    ): Result<Unit> {
        val entity = mapToOrderEntity(orderData)
        return orderSyncManager.saveOrderLocally(entity)
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private suspend fun isCurrentlyOnline(): Boolean {
        return try {
            connectivityObserver.observe().first() == ConnectivityState.CONNECTED
        } catch (e: Exception) {
            false
        }
    }

    private fun generateOrderNumber(): String {
        val currentDate = getCurrentDateString()
        if (currentDate != lastDateString) {
            dailyCounter.set(1)
            lastDateString = currentDate
        }
        val sequence = dailyCounter.getAndIncrement()
        return "$currentDate${sequence.toString().padStart(4, '0')}"
    }

    private fun getCurrentDateString(): String {
        val dateFormat = SimpleDateFormat("ddMMyy", Locale.getDefault())
        return dateFormat.format(Date())
    }

    private fun NewOrder.toMap(orderNumber: String): Map<String, Any?> = mapOf(
        "orderNumber" to orderNumber,
        "restaurantId" to restaurantId,
        "channel" to channel.toFirestoreValue(),
        "type" to type.name.lowercase(),
        "status" to OrderStatus.PENDING.name.lowercase(),
        "customerName" to customerName,
        "customerPhone" to customerPhone,
        "subtotal" to subtotal,
        "discountAmount" to discountAmount,
        "serviceCharge" to serviceCharge,
        "cgst" to cgst,
        "sgst" to sgst,
        "grandTotal" to grandTotal,
        "paymentMode" to paymentMode.name.lowercase(),
        "cashierId" to cashierId,
        "createdAt" to System.currentTimeMillis()
    )

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
