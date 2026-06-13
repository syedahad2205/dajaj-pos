package com.dajaj.pos.feature.pos.model

/**
 * Represents the complete state of the POS cart at any point in time.
 *
 * @property items Current list of items in the cart
 * @property orderType Selected order type (null if none selected)
 * @property subtotal Sum of all item line totals
 * @property cgst Central GST at 2.5% of subtotal
 * @property sgst State GST at 2.5% of subtotal
 * @property grandTotal subtotal + cgst + sgst
 * @property orderLabel Auto-generated order label in format DDMMYY####
 * @property canConfirm True when cart has items AND an order type is selected
 */
data class CartState(
    val items: List<CartItem> = emptyList(),
    val orderType: OrderType? = null,
    val subtotal: Double = 0.0,
    val cgst: Double = 0.0,
    val sgst: Double = 0.0,
    val grandTotal: Double = 0.0,
    val orderLabel: String = "",
    val canConfirm: Boolean = false
) {
    companion object {
        val EMPTY = CartState()
    }
}
