package com.dajaj.pos.data.repository

import com.dajaj.pos.common.Result
import com.dajaj.pos.data.di.OrdersCollection
import com.dajaj.pos.domain.model.OrderStateMachine
import com.dajaj.pos.domain.model.OrderStatus
import com.dajaj.pos.domain.repository.KitchenItem
import com.dajaj.pos.domain.repository.KitchenOrder
import com.dajaj.pos.domain.repository.KitchenRepository
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.Query
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Implementation of [KitchenRepository] backed by Firestore.
 *
 * Provides real-time observation of preparing orders with FIFO ordering,
 * elapsed time calculation, and overdue flagging (>30 minutes).
 * State transitions (markReady, markCompleted, cancelOrder) are validated
 * via [OrderStateMachine] before any Firestore write.
 *
 * Requirements: 11.3, 11.4, 11.6, 11.7, 11.8
 */
@Singleton
class KitchenRepositoryImpl @Inject constructor(
    @OrdersCollection private val ordersCollection: CollectionReference,
    private val firestore: FirebaseFirestore
) : KitchenRepository {

    companion object {
        private const val RESTAURANT_ID = "dajaj_main"

        /** Orders in PREPARING state for longer than this are flagged overdue. */
        private const val OVERDUE_THRESHOLD_MILLIS = 30 * 60 * 1000L // 30 minutes
    }

    /**
     * Observes orders currently in PREPARING status for the current restaurant.
     *
     * Sets up a real-time Firestore snapshot listener on the orders collection
     * filtered by status="preparing" and restaurantId. Results are sorted by
     * preparingAt ASC (FIFO — oldest first).
     *
     * Each order's elapsed time is calculated and orders exceeding 30 minutes
     * are flagged as overdue (isOverdue=true).
     *
     * COMPLETED and CANCELLED orders are automatically excluded from the query
     * via the status filter, so they disappear from the list as soon as the
     * Firestore snapshot updates (typically within 2 seconds of state change).
     *
     * @return Flow emitting the current list of preparing kitchen orders in real-time
     */
    override fun observePreparingOrders(): Flow<List<KitchenOrder>> = callbackFlow {
        var registration: ListenerRegistration? = null

        registration = ordersCollection
            .whereEqualTo("restaurantId", RESTAURANT_ID)
            .whereEqualTo("status", OrderStatus.PREPARING.toFirestoreValue())
            .orderBy("preparingAt", Query.Direction.ASCENDING)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    trySend(emptyList())
                    return@addSnapshotListener
                }

                if (snapshot == null) {
                    trySend(emptyList())
                    return@addSnapshotListener
                }

                val now = System.currentTimeMillis()
                val orders = snapshot.documents.mapNotNull { doc ->
                    mapDocumentToKitchenOrder(doc, now)
                }
                trySend(orders)
            }

        awaitClose {
            registration?.remove()
        }
    }

    /**
     * Marks an order as READY for pickup/delivery.
     *
     * Validates the transition PREPARING → READY via [OrderStateMachine] before
     * performing the Firestore write. Sets readyAt timestamp atomically.
     * Completes within 2 seconds under normal network conditions.
     *
     * @param orderId The ID of the order to mark as ready
     * @return Result indicating success or failure (including invalid transition errors)
     */
    override suspend fun markReady(orderId: String): Result<Unit> {
        return performStateTransition(
            orderId = orderId,
            targetStatus = OrderStatus.READY
        )
    }

    /**
     * Marks an order as COMPLETED (picked up or delivered).
     *
     * Validates the transition READY → COMPLETED via [OrderStateMachine] before
     * performing the Firestore write. Sets completedAt timestamp atomically.
     *
     * @param orderId The ID of the order to mark as completed
     * @return Result indicating success or failure (including invalid transition errors)
     */
    override suspend fun markCompleted(orderId: String): Result<Unit> {
        return performStateTransition(
            orderId = orderId,
            targetStatus = OrderStatus.COMPLETED
        )
    }

    /**
     * Cancels an order from the kitchen view.
     *
     * Validates the transition to CANCELLED via [OrderStateMachine] before
     * performing the Firestore write. Can be called from PREPARING or READY states.
     *
     * @param orderId The ID of the order to cancel
     * @return Result indicating success or failure (including invalid transition errors)
     */
    override suspend fun cancelOrder(orderId: String): Result<Unit> {
        return performStateTransition(
            orderId = orderId,
            targetStatus = OrderStatus.CANCELLED
        )
    }

    // --- Private Helpers ---

    /**
     * Performs a validated state transition on an order using a Firestore transaction.
     *
     * 1. Reads the order inside the transaction
     * 2. Validates the transition via [OrderStateMachine.canTransition]
     * 3. Updates the status and corresponding timestamp field atomically
     *
     * If the transition is invalid (e.g., trying to mark a COMPLETED order as READY),
     * returns an error without performing any write.
     *
     * @param orderId The document ID of the order
     * @param targetStatus The desired new status
     * @return Result indicating success or failure
     */
    private suspend fun performStateTransition(
        orderId: String,
        targetStatus: OrderStatus
    ): Result<Unit> {
        return try {
            val orderRef = ordersCollection.document(orderId)

            firestore.runTransaction { transaction ->
                val snapshot = transaction.get(orderRef)

                if (!snapshot.exists()) {
                    throw KitchenException("Order not found: $orderId")
                }

                val currentStatusStr = snapshot.getString("status")
                    ?: throw KitchenException("Order has no status field")
                val currentStatus = OrderStatus.fromString(currentStatusStr)

                // Validate transition via state machine
                if (!OrderStateMachine.canTransition(currentStatus, targetStatus)) {
                    throw KitchenException(
                        "Invalid transition: ${currentStatus.toFirestoreValue()} → ${targetStatus.toFirestoreValue()}"
                    )
                }

                // Build update map with status and timestamp
                val now = System.currentTimeMillis()
                val updates = mutableMapOf<String, Any?>(
                    "status" to targetStatus.toFirestoreValue()
                )

                // Add the corresponding timestamp field
                val timestampField = OrderStateMachine.getTimestampField(targetStatus)
                if (timestampField != null) {
                    updates[timestampField] = now
                }

                transaction.update(orderRef, updates)
            }.await()

            Result.Success(Unit)
        } catch (e: KitchenException) {
            Result.Error(e.message ?: "Kitchen operation failed", e)
        } catch (e: FirebaseFirestoreException) {
            if (e.code == FirebaseFirestoreException.Code.ABORTED ||
                e.code == FirebaseFirestoreException.Code.FAILED_PRECONDITION
            ) {
                Result.Error("Order was modified concurrently. Please try again.", e)
            } else {
                Result.Error("Failed to update order: ${e.message}", e)
            }
        } catch (e: Exception) {
            Result.Error("Failed to update order: ${e.message}", e)
        }
    }

    /**
     * Maps a Firestore [DocumentSnapshot] to a [KitchenOrder] domain model.
     *
     * Calculates elapsed time from preparingAt to [now] and flags orders
     * exceeding 30 minutes as overdue.
     *
     * @param doc The Firestore document snapshot
     * @param now The current time in epoch millis for elapsed time calculation
     * @return The mapped [KitchenOrder] or null if the document is invalid
     */
    @Suppress("UNCHECKED_CAST")
    private fun mapDocumentToKitchenOrder(doc: DocumentSnapshot, now: Long): KitchenOrder? {
        if (!doc.exists()) return null

        return try {
            val preparingAt = parseTimestamp(doc, "preparingAt") ?: return null
            val elapsed = now - preparingAt
            val isOverdue = elapsed > OVERDUE_THRESHOLD_MILLIS

            KitchenOrder(
                orderId = doc.id,
                orderNumber = doc.getString("orderNumber") ?: "",
                items = parseKitchenItems(doc),
                specialNotes = doc.getString("specialNotes"),
                preparingStartedAt = preparingAt,
                isOverdue = isOverdue
            )
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Parses kitchen items from the order document's `items` array.
     *
     * Extracts name, quantity, modifiers, and item-level notes for kitchen display.
     */
    @Suppress("UNCHECKED_CAST")
    private fun parseKitchenItems(doc: DocumentSnapshot): List<KitchenItem> {
        val rawItems = doc.get("items") as? List<Map<String, Any?>> ?: return emptyList()

        return rawItems.mapNotNull { itemMap ->
            try {
                val modifiers = when (val mods = itemMap["modifiers"]) {
                    is List<*> -> mods.mapNotNull { mod ->
                        when (mod) {
                            is String -> mod
                            is Map<*, *> -> mod["name"] as? String
                            else -> null
                        }
                    }
                    else -> emptyList()
                }

                KitchenItem(
                    name = itemMap["name"] as? String ?: return@mapNotNull null,
                    qty = (itemMap["qty"] as? Number)?.toInt() ?: 1,
                    modifiers = modifiers,
                    notes = itemMap["notes"] as? String
                )
            } catch (e: Exception) {
                null
            }
        }
    }

    /**
     * Parses a timestamp field that may be stored as a Firestore Timestamp or a Long.
     * Returns null if the field is absent or cannot be parsed.
     */
    private fun parseTimestamp(doc: DocumentSnapshot, field: String): Long? {
        return try {
            doc.getTimestamp(field)?.toDate()?.time ?: doc.getLong(field)
        } catch (e: Exception) {
            doc.getLong(field)
        }
    }
}

/**
 * Custom exception for kitchen workflow business logic errors within transactions.
 * Used to distinguish domain errors from Firestore infrastructure errors.
 */
private class KitchenException(message: String) : Exception(message)
