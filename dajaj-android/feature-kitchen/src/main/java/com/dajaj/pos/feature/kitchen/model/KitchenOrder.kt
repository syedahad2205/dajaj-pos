package com.dajaj.pos.feature.kitchen.model

/**
 * UI model representing an order currently in PREPARING state for the Kitchen screen.
 *
 * @property id Firestore document ID
 * @property orderNumber Display order number (e.g., "1104260001")
 * @property items List of order items with quantities
 * @property notes Special preparation notes (nullable)
 * @property preparingAt Timestamp (millis) when the order entered PREPARING state
 * @property isOverdue Whether the order has exceeded 30 minutes in PREPARING
 */
data class KitchenOrder(
    val id: String,
    val orderNumber: String,
    val items: List<KitchenOrderItem>,
    val notes: String?,
    val preparingAt: Long,
    val isOverdue: Boolean = false
)

/**
 * Represents a single item within a kitchen order.
 *
 * @property name Display name of the item (includes variant label if applicable)
 * @property qty Quantity ordered
 */
data class KitchenOrderItem(
    val name: String,
    val qty: Int
)
