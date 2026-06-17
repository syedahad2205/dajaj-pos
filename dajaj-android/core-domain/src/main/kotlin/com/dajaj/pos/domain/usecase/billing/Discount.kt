package com.dajaj.pos.domain.usecase.billing

/**
 * Represents a discount to be applied to an order.
 *
 * @property type Whether the discount is a percentage or a fixed amount.
 * @property value The discount value (percentage 0-100, or fixed amount not exceeding subtotal).
 * @property reason The reason for applying the discount (1-100 characters required).
 */
data class Discount(
    val type: DiscountType,
    val value: Double,
    val reason: String
)
