package com.dajaj.pos.feature.pos.model

/**
 * Represents a selected modifier applied to a cart item.
 */
data class ModifierSelection(
    val id: String,
    val name: String,
    val price: Double,
    val groupName: String
)
