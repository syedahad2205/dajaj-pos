package com.dajaj.pos.data.repository

import com.dajaj.pos.common.Result
import com.dajaj.pos.data.di.PendingOrdersCollection
import com.dajaj.pos.data.remote.PendingOrderRemoteDataSource
import com.dajaj.pos.domain.model.OrderChannel
import com.dajaj.pos.domain.model.PendingOrder
import com.dajaj.pos.domain.model.PendingOrderItem
import com.dajaj.pos.domain.model.PendingOrderStatus
import com.dajaj.pos.domain.repository.PendingOrderRepository
import com.google.firebase.Timestamp
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.DocumentSnapshot
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Implementation of [PendingOrderRepository] that delegates real-time observation
 * to [PendingOrderRemoteDataSource] and performs accept/reject mutations directly
 * against Firestore.
 *
 * Accept updates the pending order status to "accepted" and sets processedAt.
 * Reject updates the status to "rejected", stores the rejection reason, and sets processedAt.
 */
@Singleton
class PendingOrderRepositoryImpl @Inject constructor(
    private val remoteDataSource: PendingOrderRemoteDataSource,
    @PendingOrdersCollection private val pendingOrdersCollection: CollectionReference
) : PendingOrderRepository {

    /**
     * Observes pending orders for the given restaurant via real-time Firestore listener.
     * Orders are filtered by status=pending and sorted by createdAt ascending.
     */
    override fun observePendingOrders(restaurantId: String): Flow<List<PendingOrder>> {
        return remoteDataSource.observePendingOrders(restaurantId)
    }

    /**
     * Accepts a pending order by updating its Firestore document:
     * - Sets status to "accepted"
     * - Sets processedAt to server timestamp
     *
     * @param orderId The ID of the pending order document
     * @return Result indicating success or failure
     */
    override suspend fun acceptOrder(orderId: String): Result<Unit> {
        return try {
            pendingOrdersCollection.document(orderId)
                .update(
                    mapOf(
                        "status" to PendingOrderStatus.ACCEPTED.toFirestoreValue(),
                        "processedAt" to Timestamp.now()
                    )
                )
                .await()
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error("Failed to accept order: ${e.message}", e)
        }
    }

    /**
     * Rejects a pending order by updating its Firestore document:
     * - Sets status to "rejected"
     * - Sets rejectionReason to the provided reason
     * - Sets processedAt to server timestamp
     *
     * @param orderId The ID of the pending order document
     * @param reason The rejection reason (1–200 characters)
     * @return Result indicating success or failure
     */
    override suspend fun rejectOrder(orderId: String, reason: String): Result<Unit> {
        return try {
            pendingOrdersCollection.document(orderId)
                .update(
                    mapOf(
                        "status" to PendingOrderStatus.REJECTED.toFirestoreValue(),
                        "rejectionReason" to reason,
                        "processedAt" to Timestamp.now()
                    )
                )
                .await()
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error("Failed to reject order: ${e.message}", e)
        }
    }

    /**
     * Retrieves a single pending order by its document ID from Firestore.
     *
     * @param orderId The ID of the pending order document
     * @return Result containing the pending order if found
     */
    override suspend fun getOrderById(orderId: String): Result<PendingOrder> {
        return try {
            val snapshot = pendingOrdersCollection.document(orderId).get().await()
            val order = mapDocumentToPendingOrder(snapshot)
                ?: return Result.Error("Order not found or has invalid data")
            Result.Success(order)
        } catch (e: Exception) {
            Result.Error("Failed to get order: ${e.message}", e)
        }
    }

    /**
     * Maps a Firestore [DocumentSnapshot] to a [PendingOrder] domain model.
     * Returns null if the document doesn't exist or is missing required fields.
     */
    private fun mapDocumentToPendingOrder(doc: DocumentSnapshot): PendingOrder? {
        if (!doc.exists()) return null

        return try {
            PendingOrder(
                id = doc.id,
                restaurantId = doc.getString("restaurantId") ?: return null,
                orderNumber = doc.getString("orderNumber") ?: return null,
                channel = OrderChannel.fromString(doc.getString("channel") ?: "website"),
                status = PendingOrderStatus.fromString(doc.getString("status") ?: "pending"),
                customerName = doc.getString("customerName") ?: "",
                customerPhone = doc.getString("customerPhone") ?: "",
                items = parseItems(doc),
                total = doc.getDouble("total") ?: 0.0,
                notes = doc.getString("notes"),
                rejectionReason = doc.getString("rejectionReason"),
                createdAt = parseTimestamp(doc, "createdAt"),
                processedAt = parseNullableTimestamp(doc, "processedAt")
            )
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Parses the `items` array field from a Firestore document.
     */
    @Suppress("UNCHECKED_CAST")
    private fun parseItems(doc: DocumentSnapshot): List<PendingOrderItem> {
        val rawItems = doc.get("items") as? List<Map<String, Any?>> ?: return emptyList()

        return rawItems.mapNotNull { itemMap ->
            try {
                PendingOrderItem(
                    name = itemMap["name"] as? String ?: return@mapNotNull null,
                    qty = (itemMap["qty"] as? Number)?.toInt() ?: 1,
                    price = (itemMap["price"] as? Number)?.toDouble() ?: 0.0,
                    total = (itemMap["total"] as? Number)?.toDouble() ?: 0.0
                )
            } catch (e: Exception) {
                null
            }
        }
    }

    /**
     * Parses a timestamp field that may be stored as a Firestore Timestamp or a Long.
     */
    private fun parseTimestamp(doc: DocumentSnapshot, field: String): Long {
        return try {
            doc.getTimestamp(field)?.toDate()?.time ?: doc.getLong(field) ?: 0L
        } catch (e: Exception) {
            doc.getLong(field) ?: 0L
        }
    }

    /**
     * Parses an optional timestamp field, returning null if the field is absent.
     */
    private fun parseNullableTimestamp(doc: DocumentSnapshot, field: String): Long? {
        return try {
            doc.getTimestamp(field)?.toDate()?.time ?: doc.getLong(field)
        } catch (e: Exception) {
            doc.getLong(field)
        }
    }
}
