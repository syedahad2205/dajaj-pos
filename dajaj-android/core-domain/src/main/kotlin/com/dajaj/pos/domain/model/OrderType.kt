package com.dajaj.pos.domain.model

/**
 * Identifies the type/mode of an order for fulfillment purposes.
 */
enum class OrderType {
    /** Walk-in customer, order consumed on premises or taken away immediately. */
    WALK_IN,

    /** Customer takes food away. */
    TAKEAWAY,

    /** Customer dines in at the restaurant. */
    DINE_IN,

    /** Order to be delivered to the customer's address. */
    DELIVERY;

    companion object {
        fun fromString(value: String): OrderType = when (value.lowercase()) {
            "walk_in" -> WALK_IN
            "takeaway" -> TAKEAWAY
            "dine_in" -> DINE_IN
            "delivery" -> DELIVERY
            else -> WALK_IN
        }
    }

    fun toFirestoreValue(): String = when (this) {
        WALK_IN -> "walk_in"
        TAKEAWAY -> "takeaway"
        DINE_IN -> "dine_in"
        DELIVERY -> "delivery"
    }
}
