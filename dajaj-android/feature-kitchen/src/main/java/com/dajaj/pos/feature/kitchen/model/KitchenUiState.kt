package com.dajaj.pos.feature.kitchen.model

/**
 * UI state for the Kitchen screen.
 *
 * @property orders List of orders in PREPARING state, sorted by preparingAt ASC (FIFO)
 * @property preparingCount Count of orders currently in PREPARING state
 * @property isLoading Whether initial data load is in progress
 * @property error Error message if the Firestore listener encounters an error
 */
data class KitchenUiState(
    val orders: List<KitchenOrder> = emptyList(),
    val preparingCount: Int = 0,
    val isLoading: Boolean = true,
    val error: String? = null
) {
    val isEmpty: Boolean get() = orders.isEmpty() && !isLoading
}
