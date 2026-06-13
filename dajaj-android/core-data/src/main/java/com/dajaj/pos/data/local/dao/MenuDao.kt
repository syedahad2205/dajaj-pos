package com.dajaj.pos.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Upsert
import com.dajaj.pos.data.local.entity.MenuEntity
import kotlinx.coroutines.flow.Flow

/**
 * Data Access Object for the menus table.
 * Provides queries for menu tree navigation, filtering, and cache management.
 */
@Dao
interface MenuDao {

    /**
     * Returns all menu items as a reactive Flow.
     * Used for full menu cache observation.
     */
    @Query("SELECT * FROM menus ORDER BY `order` ASC")
    fun getAllMenuItems(): Flow<List<MenuEntity>>

    /**
     * Returns children of a given parent, sorted by their display order.
     * Used to navigate the menu tree: categories → variants → modifierGroups → modifiers.
     */
    @Query("SELECT * FROM menus WHERE parentId = :parentId ORDER BY `order` ASC")
    fun getByParentId(parentId: String): Flow<List<MenuEntity>>

    /**
     * Returns root-level items (those with null parentId), sorted by order.
     * Typically these are top-level categories.
     */
    @Query("SELECT * FROM menus WHERE parentId IS NULL ORDER BY `order` ASC")
    fun getRootCategories(): Flow<List<MenuEntity>>

    /**
     * Returns all menu items of a specific type.
     * Types: category, variant, modifierGroup, modifier.
     */
    @Query("SELECT * FROM menus WHERE type = :type ORDER BY `order` ASC")
    fun getByType(type: String): Flow<List<MenuEntity>>

    /**
     * Returns all available variants (type='variant' AND isAvailable=true).
     * Used to populate the POS center panel with orderable items.
     */
    @Query("SELECT * FROM menus WHERE type = 'variant' AND isAvailable = 1 ORDER BY `order` ASC")
    fun getAvailableVariants(): Flow<List<MenuEntity>>

    /**
     * Returns a single menu item by its ID.
     */
    @Query("SELECT * FROM menus WHERE id = :id")
    suspend fun getById(id: String): MenuEntity?

    /**
     * Inserts all menu items, replacing any existing ones with the same primary key.
     * Used for bulk cache refresh from Firestore.
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(menus: List<MenuEntity>)

    /**
     * Deletes all menu items from the local cache.
     * Called before a full re-sync from Firestore.
     */
    @Query("DELETE FROM menus")
    suspend fun deleteAll()

    /**
     * Upserts (insert or update) menu items.
     * Used for incremental sync when individual items change in Firestore.
     */
    @Upsert
    suspend fun upsert(menus: List<MenuEntity>)

    /**
     * Atomic cache replacement: deletes all existing items and inserts fresh data.
     * Ensures no partial state during a full menu sync.
     */
    @Transaction
    suspend fun replaceAll(menus: List<MenuEntity>) {
        deleteAll()
        insertAll(menus)
    }
}
