package com.dajaj.pos.feature.pos.model

import com.dajaj.pos.domain.model.PaymentMethod
import com.dajaj.pos.domain.model.PaymentSplit

/**
 * State for the payment dialog during order confirmation.
 *
 * Tracks selected payment method, cash input, and mixed payment splits.
 */
data class PaymentDialogState(
    /** Selected payment method. */
    val selectedMethod: PaymentMethod = PaymentMethod.CASH,

    /** Cash collected input (for CASH method). */
    val cashCollected: Double? = null,

    /** Change to return to customer. */
    val changeAmount: Double = 0.0,

    /** Payment splits for MIXED payment (max 4). */
    val splits: List<MixedSplitEntry> = listOf(
        MixedSplitEntry(method = PaymentMethod.CASH, amount = 0.0),
        MixedSplitEntry(method = PaymentMethod.CARD, amount = 0.0)
    ),

    /** Grand total amount (for display and validation). */
    val grandTotal: Double = 0.0,

    /** Whether the current payment configuration is valid. */
    val isValid: Boolean = false,

    /** Error message to display, if any. */
    val errorMessage: String? = null
)

/**
 * A single entry in a mixed payment split.
 */
data class MixedSplitEntry(
    val method: PaymentMethod,
    val amount: Double
)
