package com.dajaj.pos.domain.repository

import com.dajaj.pos.common.Result
import kotlinx.coroutines.flow.Flow

/**
 * Repository interface for kitchen workflow operations.
 *
 * Manages the preparation queue with FIFO ordering and timing.
 * Orders flow into the kitchen after acceptance and KOT generation,
 * progressing through PREPARING → READY → COMPLETED states.
 *
 * Invalid state transitions are rejected at the domain layer before any
 * Firestore write. The same state machine applies regardless of order source channel.
 */
interface KitchenRepository {

    /**
     * Observes orders currently in PREPARING status for the current restaurant.
     * Sorted by preparation start time ascending (FIFO / oldest first).
     * Orders older than 30 minutes are flagged as overdue.
     *
     * @return Flow emitting the current list of preparing kitchen orders in real-time
     */
    fun observePreparingOrders(): Flow<List<KitchenOrder>>

    /**
     * Marks an order as READY for pickup/delivery.
     * Transitions status from PREPARING → READY and sets the readyAt timestamp.
     *
     * @param orderId The ID of the order to mark as ready
     * @return Result indicating success or failure
     */
    suspend fun markReady(orderId: String): Result<Unit>

    /**
     * Marks an order as COMPLETED (picked up or delivered).
     * Transitions status from READY → COMPLETED and sets the completedAt timestamp.
     *
     * @param orderId The ID of the order to mark as completed
     * @return Result indicating success or failure
     */
    suspend fun markCompleted(orderId: String): Result<Unit>

    /**
     * Cancels an order from the kitchen view.
     * Can be called from PREPARING or READY states.
     * Transitions the order to CANCELLED status.
     *
     * @param orderId The ID of the order to cancel
     * @return Result indicating success or failure
     */
    suspend fun cancelOrder(orderId: String): Result<Unit>
}

/**
 * Domain model representing an order in the kitchen preparation queue.
 *
 * Contains only the information relevant to kitchen staff: items to prepare,
 * special notes, timing, and overdue status.
 */
data class KitchenOrder(
    /** Order ID (Firestore document ID). */
    val orderId: String,

    /** Human-readable order number (format: DDMMYY####). */
    val orderNumber: String,

    /** Items to prepare for this order. */
    val items: List<KitchenItem>,

    /** Special preparation notes from the customer or cashier. */
    val specialNotes: String?,

    /** Timestamp when preparation started (epoch millis). */
    val preparingStartedAt: Long,

    /** True if the order has been in PREPARING state for more than 30 minutes. */
    val isOverdue: Boolean
)

/**
 * A single item in a kitchen order showing what needs to be prepared.
 */
data class KitchenItem(
    /** Display name of the item. */
    val name: String,

    /** Quantity to prepare. */
    val qty: Int,

    /** Applied modifiers (e.g., "Extra Spicy"). */
    val modifiers: List<String>,

    /** Item-specific preparation notes, if any. */
    val notes: String?
)
