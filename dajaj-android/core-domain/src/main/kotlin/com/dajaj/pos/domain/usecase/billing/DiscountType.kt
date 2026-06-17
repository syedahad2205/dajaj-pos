package com.dajaj.pos.domain.usecase.billing

/**
 * The type of discount applied to an order.
 */
enum class DiscountType {
    /** Percentage-based discount (0-100%). */
    PERCENTAGE,

    /** Fixed amount discount (must not exceed subtotal). */
    FIXED
}
