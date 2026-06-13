package com.dajaj.pos.feature.pos.modifier

import com.dajaj.pos.domain.model.SelectionType

/**
 * Presentation model representing a modifier group in the modifier selection sheet.
 * Extracted from the domain [MenuItem] hierarchy for UI rendering.
 */
data class ModifierGroupData(
    val id: String,
    val name: String,
    val selectionType: SelectionType,
    val minSelection: Int,
    val maxSelection: Int,
    val modifiers: List<ModifierData>
)

/**
 * Presentation model representing a single modifier option within a group.
 */
data class ModifierData(
    val id: String,
    val name: String,
    val price: Double
)
