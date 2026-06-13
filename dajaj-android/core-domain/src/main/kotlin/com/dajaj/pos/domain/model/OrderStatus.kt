package com.dajaj.pos.domain.model

/**
 * Represents the lifecycle status of an order in the Dajaj ecosystem.
 *
 * All orders—regardless of source channel (walk-in, WhatsApp, website, QR,
 * third-party)—follow the same state progression:
 *
 * PENDING → ACCEPTED → PREPARING → READY → COMPLETED
 *
 * Additional terminal transitions:
 * - PENDING → REJECTED (cashier rejects with reason)
 * - Any active state → CANCELLED
 *
 * Skipping states is not permitted.
 */
enum class OrderStatus {
    /** Order created, awaiting cashier action. */
    PENDING,

    /** Order accepted by cashier, awaiting KOT generation. */
    ACCEPTED,

    /** Order rejected by cashier with a reason. Terminal state. */
    REJECTED,

    /** Order is being prepared in the kitchen. */
    PREPARING,

    /** Order is ready for customer pickup/serving. */
    READY,

    /** Order delivered to customer. Terminal state. */
    COMPLETED,

    /** Order cancelled. Terminal state. */
    CANCELLED;

    companion object {
        fun fromString(value: String): OrderStatus = when (value.lowercase()) {
            "pending" -> PENDING
            "accepted" -> ACCEPTED
            "rejected" -> REJECTED
            "preparing" -> PREPARING
            "ready" -> READY
            "completed" -> COMPLETED
            "cancelled" -> CANCELLED
            else -> PENDING
        }
    }

    fun toFirestoreValue(): String = when (this) {
        PENDING -> "pending"
        ACCEPTED -> "accepted"
        REJECTED -> "rejected"
        PREPARING -> "preparing"
        READY -> "ready"
        COMPLETED -> "completed"
        CANCELLED -> "cancelled"
    }
}
