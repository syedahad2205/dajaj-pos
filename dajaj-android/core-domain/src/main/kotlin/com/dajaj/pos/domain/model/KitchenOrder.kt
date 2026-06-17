package com.dajaj.pos.domain.model

/**
 * Domain model representing an order in the kitchen preparation queue.
 *
 * Kitchen orders are displayed in FIFO order and marked as overdue
 * if preparation exceeds 30 minutes.
 */
data class KitchenOrder(
    /** The associated order ID. */
    val orderId: String,

    /** Human-readable order number (format: DDMMYY####). */
    val orderNumber: String,

    /** Items to prepare for this order. */
    val items: List<KitchenItem>,

    /** Special preparation notes for the entire order. */
    val specialNotes: String?,

    /** Timestamp when preparation started (epoch millis). */
    val preparingStartedAt: Long,

    /** True if preparation has exceeded 30 minutes. */
    val isOverdue: Boolean
)

/**
 * Represents a single item in a kitchen order for display on the KOT.
 */
data class KitchenItem(
    /** Quantity to prepare. */
    val qty: Int,

    /** Display name of the item (including variant). */
    val name: String,

    /** Applied modifiers displayed on the KOT. */
    val modifiers: List<String>,

    /** Item-specific preparation notes. */
    val notes: String?
)
