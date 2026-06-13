package com.dajaj.pos.domain.model

/**
 * Domain model representing a menu node in the hierarchical menu tree.
 * Maps 1:1 with Firestore menu documents and Room [MenuEntity] records.
 *
 * Tree structure: category → variant → modifierGroup → modifier
 */
data class MenuItem(
    val id: String,
    val name: String,
    val parentId: String?,
    val type: MenuItemType,
    val price: Double,
    val selectionType: SelectionType,
    val minSelection: Int,
    val maxSelection: Int,
    val description: String?,
    val imageUrl: String?,
    val isAvailable: Boolean,
    val trackInventory: Boolean,
    val inventoryMultiplier: Double?,
    val inventoryTrackingMode: String?,
    val order: Int,
    val createdAt: Long,
    val updatedAt: Long
)

/**
 * Types of nodes in the menu tree hierarchy.
 */
enum class MenuItemType {
    CATEGORY,
    VARIANT,
    MODIFIER_GROUP,
    MODIFIER;

    companion object {
        fun fromString(value: String): MenuItemType = when (value.lowercase()) {
            "category" -> CATEGORY
            "variant" -> VARIANT
            "modifiergroup", "modifier_group" -> MODIFIER_GROUP
            "modifier" -> MODIFIER
            else -> CATEGORY
        }
    }

    fun toFirestoreValue(): String = when (this) {
        CATEGORY -> "category"
        VARIANT -> "variant"
        MODIFIER_GROUP -> "modifierGroup"
        MODIFIER -> "modifier"
    }
}

/**
 * Selection types for modifier groups.
 */
enum class SelectionType {
    SINGLE,
    MULTIPLE,
    NONE;

    companion object {
        fun fromString(value: String): SelectionType = when (value.lowercase()) {
            "single" -> SINGLE
            "multiple" -> MULTIPLE
            else -> NONE
        }
    }

    fun toFirestoreValue(): String = when (this) {
        SINGLE -> "single"
        MULTIPLE -> "multiple"
        NONE -> ""
    }
}
