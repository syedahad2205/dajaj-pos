package com.dajaj.pos.domain.model

/**
 * Payment methods supported by the Dajaj POS billing system.
 */
enum class PaymentMethod {
    /** Cash payment. */
    CASH,

    /** Card payment (credit/debit). */
    CARD,

    /** UPI payment (Google Pay, PhonePe, etc.). */
    UPI,

    /** Mixed payment — split across multiple methods (max 4 splits). */
    MIXED;

    companion object {
        fun fromString(value: String): PaymentMethod = when (value.lowercase()) {
            "cash" -> CASH
            "card" -> CARD
            "upi" -> UPI
            "mixed" -> MIXED
            else -> CASH
        }
    }

    fun toFirestoreValue(): String = when (this) {
        CASH -> "cash"
        CARD -> "card"
        UPI -> "upi"
        MIXED -> "mixed"
    }
}
