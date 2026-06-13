package com.dajaj.pos.data.local

import com.dajaj.pos.data.local.dao.MenuDao
import com.dajaj.pos.data.local.entity.MenuEntity
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Local data source wrapping [MenuDao] operations for menu cache management.
 *
 * Provides a clean abstraction over Room DAO calls, serving as the read-through
 * cache layer for offline-first menu access.
 */
@Singleton
class MenuLocalDataSource @Inject constructor(
    private val menuDao: MenuDao
) {

    /**
     * Observes all menu items from the local Room database.
     * Returns items sorted by display order ascending.
     */
    fun getAllMenuItems(): Flow<List<MenuEntity>> {
        return menuDao.getAllMenuItems()
    }

    /**
     * Observes menu items that are children of the given [parentId].
     * Sorted by display order ascending.
     */
    fun getByParentId(parentId: String): Flow<List<MenuEntity>> {
        return menuDao.getByParentId(parentId)
    }

    /**
     * Observes root-level categories (items with null parentId).
     * These are top-level menu categories displayed in the POS left panel.
     */
    fun getRootCategories(): Flow<List<MenuEntity>> {
        return menuDao.getRootCategories()
    }

    /**
     * Observes all available variants (type='variant' AND isAvailable=true).
     * Used for the POS center panel item grid.
     */
    fun getAvailableVariants(): Flow<List<MenuEntity>> {
        return menuDao.getAvailableVariants()
    }

    /**
     * Returns a single menu item by its ID, or null if not found.
     */
    suspend fun getById(id: String): MenuEntity? {
        return menuDao.getById(id)
    }

    /**
     * Atomically replaces all menu items in the local cache.
     * Deletes existing data and inserts the new [menus] list in a single transaction.
     * Used for full collection sync from Firestore.
     */
    suspend fun replaceAll(menus: List<MenuEntity>) {
        menuDao.replaceAll(menus)
    }

    /**
     * Upserts (insert or update) the given [menus] into the local cache.
     * Used for incremental sync when individual documents change in Firestore.
     */
    suspend fun upsert(menus: List<MenuEntity>) {
        menuDao.upsert(menus)
    }

    /**
     * Deletes all menu items from the local cache.
     */
    suspend fun deleteAll() {
        menuDao.deleteAll()
    }
}
