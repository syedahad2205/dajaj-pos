package com.dajaj.pos.domain.model

/**
 * Represents a single payment split in a MIXED payment scenario.
 *
 * A bill can have up to 4 payment splits across different methods.
 */
data class PaymentSplit(
    /** The payment method for this split. */
    val method: PaymentMethod,

    /** Amount paid via this method. */
    val amount: Double
)
