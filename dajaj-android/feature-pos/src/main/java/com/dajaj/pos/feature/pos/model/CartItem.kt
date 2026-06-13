package com.dajaj.pos.feature.pos.model

import com.dajaj.pos.feature.pos.MenuItem

/**
 * Data class representing an item in the cart with full details.
 *
 * @property menuItem Reference to the original menu item added
 * @property quantity Current quantity in the cart
 * @property modifiers List of selected modifiers (empty for now)
 * @property lineTotal Calculated: (basePrice + modifierPrices) * quantity
 */
data class CartItem(
    val menuItem: MenuItem,
    val quantity: Int = 1,
    val modifiers: List<ModifierSelection> = emptyList()
) {
    /**
     * Computed line total: (base price + sum of modifier prices) * quantity.
     */
    val lineTotal: Double
        get() {
            val modifierTotal = modifiers.sumOf { it.price }
            return (menuItem.price.toDouble() + modifierTotal) * quantity
        }

    /**
     * Formatted modifier string for display.
     */
    val modifierDisplay: String?
        get() = if (modifiers.isEmpty()) null
        else modifiers.joinToString(", ") { it.name }
}
