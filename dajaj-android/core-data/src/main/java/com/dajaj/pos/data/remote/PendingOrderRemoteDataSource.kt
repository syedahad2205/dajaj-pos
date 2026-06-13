package com.dajaj.pos.data.remote

import com.dajaj.pos.data.di.PendingOrdersCollection
import com.dajaj.pos.domain.model.OrderChannel
import com.dajaj.pos.domain.model.PendingOrder
import com.dajaj.pos.domain.model.PendingOrderItem
import com.dajaj.pos.domain.model.PendingOrderStatus
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.QuerySnapshot
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Remote data source that establishes a real-time Firestore listener
 * on the `pending_orders` collection, filtered by restaurantId and status=pending,
 * sorted by createdAt ascending (oldest first).
 *
 * Emits [PendingOrder] domain models whenever the query results change.
 */
@Singleton
class PendingOrderRemoteDataSource @Inject constructor(
    @PendingOrdersCollection private val pendingOrdersCollection: CollectionReference
) {

    /**
     * Observes pending orders for a given restaurant in real-time.
     *
     * Queries Firestore for documents where:
     * - `restaurantId` equals [restaurantId]
     * - `status` equals "pending"
     * Sorted by `createdAt` ascending so the oldest order appears first.
     *
     * @param restaurantId The restaurant to observe pending orders for
     * @return A [Flow] emitting the current list of pending orders on every change
     */
    fun observePendingOrders(restaurantId: String): Flow<List<PendingOrder>> = callbackFlow {
        val query = pendingOrdersCollection
            .whereEqualTo("restaurantId", restaurantId)
            .whereEqualTo("status", "pending")
            .orderBy("createdAt", Query.Direction.ASCENDING)

        val listenerRegistration: ListenerRegistration = query
            .addSnapshotListener { snapshot: QuerySnapshot?, error ->
                if (error != null) {
                    close(error)
                    return@addSnapshotListener
                }

                if (snapshot != null) {
                    val pendingOrders = snapshot.documents.mapNotNull { doc ->
                        mapDocumentToPendingOrder(doc)
                    }
                    trySend(pendingOrders)
                }
            }

        awaitClose {
            listenerRegistration.remove()
        }
    }

    /**
     * Maps a Firestore [DocumentSnapshot] to a [PendingOrder] domain model.
     * Returns `null` if the document is missing required fields.
     */
    private fun mapDocumentToPendingOrder(doc: DocumentSnapshot): PendingOrder? {
        if (!doc.exists()) return null

        return try {
            val itemsList = parseItems(doc)

            PendingOrder(
                id = doc.id,
                restaurantId = doc.getString("restaurantId") ?: return null,
                orderNumber = doc.getString("orderNumber") ?: return null,
                channel = OrderChannel.fromString(doc.getString("channel") ?: "website"),
                status = PendingOrderStatus.fromString(doc.getString("status") ?: "pending"),
                customerName = doc.getString("customerName") ?: "",
                customerPhone = doc.getString("customerPhone") ?: "",
                items = itemsList,
                total = doc.getDouble("total") ?: 0.0,
                notes = doc.getString("notes"),
                rejectionReason = doc.getString("rejectionReason"),
                createdAt = parseTimestamp(doc, "createdAt"),
                processedAt = parseNullableTimestamp(doc, "processedAt")
            )
        } catch (e: Exception) {
            // Skip malformed documents silently
            null
        }
    }

    /**
     * Parses the `items` array field from a Firestore document into a list of [PendingOrderItem].
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
