package com.dajaj.pos.data.local.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Room entity representing a menu node from the Firestore `menus` collection.
 * Supports hierarchical tree structure via parentId self-reference.
 * Used as a read-through cache of Firestore data for offline access.
 */
@Entity(
    tableName = "menus",
    indices = [
        Index(value = ["parentId", "order"]),
        Index(value = ["type", "isAvailable"]),
        Index(value = ["isAvailable"])
    ]
)
data class MenuEntity(
    @PrimaryKey
    val id: String,
    val name: String,
    @ColumnInfo(name = "parentId")
    val parentId: String?,
    val type: String, // category, variant, modifierGroup, modifier
    val price: Double,
    val selectionType: String, // single, multiple, ""
    val minSelection: Int,
    val maxSelection: Int,
    val description: String?,
    val imageUrl: String?,
    val isAvailable: Boolean,
    val trackInventory: Boolean,
    val inventoryMultiplier: Double?,
    val inventoryTrackingMode: String?,
    @ColumnInfo(name = "order")
    val order: Int,
    val createdAt: Long,
    val updatedAt: Long
)
