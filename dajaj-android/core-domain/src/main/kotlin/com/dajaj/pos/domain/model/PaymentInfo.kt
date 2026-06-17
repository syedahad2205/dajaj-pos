package com.dajaj.pos.domain.model

/**
 * Value object representing payment details for an order.
 *
 * For MIXED payments, [splits] contains the breakdown (max 4 entries).
 * For CASH payments, [cashCollected] captures the amount tendered for change calculation.
 */
data class PaymentInfo(
    /** The payment method used. */
    val method: PaymentMethod,

    /** Cash amount collected (for change calculation), null if not cash. */
    val cashCollected: Double?,

    /** Payment splits for MIXED payments (max 4 entries), null otherwise. */
    val splits: List<PaymentSplit>?
)
