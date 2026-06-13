package com.dajaj.pos.domain.model

/**
 * Represents a single line item within a pending order.
 *
 * Contains the item name, quantity, unit price, and calculated line total.
 */
data class PendingOrderItem(
    val name: String,
    val qty: Int,
    val price: Double,
    val total: Double
)
