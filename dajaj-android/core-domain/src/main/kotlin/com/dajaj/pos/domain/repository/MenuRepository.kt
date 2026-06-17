package com.dajaj.pos.domain.repository

import com.dajaj.pos.domain.model.MenuItem
import kotlinx.coroutines.flow.Flow

/**
 * Repository interface for menu data access.
 *
 * Follows the offline-first pattern: data is always served from the local Room cache,
 * while Firestore acts as the authoritative source that syncs changes into Room
 * via a real-time listener.
 */
interface MenuRepository {

    /**
     * Observes the full menu as a reactive [Flow].
     * Data is served from the local cache (Room) for offline-first access.
     */
    fun observeMenu(): Flow<List<MenuItem>>

    /**
     * Observes root-level categories (items with null parentId).
     * Sorted by display order ascending.
     */
    fun getCategories(): Flow<List<MenuItem>>

    /**
     * Observes menu items that are children of the given [categoryId].
     * Sorted by display order ascending.
     */
    fun getItemsByCategory(categoryId: String): Flow<List<MenuItem>>

    /**
     * Searches menu items by name (case-insensitive substring match).
     * Returns items matching the [query] from the local cache.
     */
    fun searchItems(query: String): Flow<List<MenuItem>>

    /**
     * Starts the Firestore → Room synchronization listener.
     * Should be called when the app initializes or connectivity is restored.
     */
    suspend fun startSync()

    /**
     * Stops the Firestore listener. Called when the app is shutting down
     * or when sync should be paused.
     */
    fun stopSync()

    /**
     * Returns a snapshot of the current cached menu items from Room.
     * Non-reactive — use [observeMenu] for real-time updates.
     */
    suspend fun getCachedMenu(): List<MenuItem>
}
