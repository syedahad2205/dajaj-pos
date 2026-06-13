package com.dajaj.pos.domain.model

/**
 * Domain model representing an incoming order from an external channel
 * (WhatsApp, Website, QR, Swiggy, Zomato) awaiting cashier acceptance.
 *
 * Pending orders flow through Firestore's `pending_orders` collection and are
 * displayed in the Android POS for the cashier to accept or reject.
 */
data class PendingOrder(
    val id: String,
    val restaurantId: String,
    val orderNumber: String,
    val channel: OrderChannel,
    val status: PendingOrderStatus,
    val customerName: String,
    val customerPhone: String,
    val items: List<PendingOrderItem>,
    val total: Double,
    val notes: String?,
    val rejectionReason: String?,
    val createdAt: Long,
    val processedAt: Long?
)
