package com.dajaj.pos.domain.model

/**
 * Represents a single item in the POS cart during order creation.
 *
 * Contains the selected menu item, variant, modifiers, quantity, notes,
 * and the computed line total.
 */
data class CartItem(
    /** Unique identifier for this cart entry. */
    val id: String,

    /** The base menu item being ordered. */
    val menuItem: MenuItem,

    /** Selected variant (e.g., Quarter, Half, Full), null if no variants. */
    val variant: MenuItem?,

    /** Selected modifiers applied to this item. */
    val modifiers: List<MenuItem>,

    /** Quantity of this item (1-99). */
    val quantity: Int,

    /** Special preparation notes for this item. */
    val notes: String?,

    /**
     * Computed line total: (variant price or item price + sum of modifier prices) * quantity.
     */
    val lineTotal: Double
)
