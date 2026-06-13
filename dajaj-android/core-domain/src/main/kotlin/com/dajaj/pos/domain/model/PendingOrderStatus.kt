package com.dajaj.pos.domain.model

/**
 * Represents the lifecycle status of a pending order from an external channel.
 *
 * Pending orders arrive from channels like WhatsApp, Website, or QR and must be
 * explicitly accepted or rejected by a cashier on the Android POS.
 */
enum class PendingOrderStatus {
    PENDING,
    ACCEPTED,
    REJECTED;

    companion object {
        fun fromString(value: String): PendingOrderStatus = when (value.lowercase()) {
            "pending" -> PENDING
            "accepted" -> ACCEPTED
            "rejected" -> REJECTED
            else -> PENDING
        }
    }

    fun toFirestoreValue(): String = when (this) {
        PENDING -> "pending"
        ACCEPTED -> "accepted"
        REJECTED -> "rejected"
    }
}
