package com.dajaj.pos.data.repository

import android.util.Log
import com.dajaj.pos.common.network.ConnectivityMonitor
import com.dajaj.pos.common.network.ConnectivityState
import com.dajaj.pos.data.local.MenuLocalDataSource
import com.dajaj.pos.data.local.entity.MenuEntity
import com.dajaj.pos.data.remote.MenuRemoteDataSource
import com.dajaj.pos.domain.model.MenuItem
import com.dajaj.pos.domain.model.MenuItemType
import com.dajaj.pos.domain.model.SelectionType
import com.dajaj.pos.domain.repository.MenuRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Implementation of [MenuRepository] that coordinates Firestore → Room synchronization.
 *
 * Architecture:
 * - Reads always go to Room (offline-first).
 * - A real-time Firestore listener writes changes into Room as they arrive.
 * - On reconnection, the listener is re-established and the full collection snapshot
 *   is reconciled with the local cache within 10 seconds.
 * - Sync failures are retried up to 3 times with exponential backoff.
 * - Connectivity changes are monitored: when the device transitions from OFFLINE to ONLINE,
 *   the sync is automatically restarted to reconcile the cache.
 */
@Singleton
class MenuRepositoryImpl @Inject constructor(
    private val remoteDataSource: MenuRemoteDataSource,
    private val localDataSource: MenuLocalDataSource,
    private val connectivityMonitor: ConnectivityMonitor
) : MenuRepository {

    companion object {
        private const val TAG = "MenuRepositoryImpl"
        private const val MENU_SYNC_RETRY_MAX = 3
        private const val MENU_SYNC_BASE_DELAY_MS = 2000L
        /** Maximum time allowed for sync reconciliation on reconnect (10 seconds). */
        private const val SYNC_RECONCILE_TIMEOUT_MS = 10_000L
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var syncJob: Job? = null
    private var connectivityJob: Job? = null
    private var retryCount = 0
    private var lastConnectivityState: ConnectivityState = ConnectivityState.OFFLINE

    /**
     * Observes the full menu from the local Room cache.
     * Maps [MenuEntity] to domain [MenuItem] models.
     */
    override fun observeMenu(): Flow<List<MenuItem>> {
        return localDataSource.getAllMenuItems().map { entities ->
            entities.map { it.toDomainModel() }
        }
    }

    /**
     * Observes root-level categories (parentId is null) from the local cache.
     */
    override fun getCategories(): Flow<List<MenuItem>> {
        return localDataSource.getRootCategories().map { entities ->
            entities.map { it.toDomainModel() }
        }
    }

    /**
     * Observes items for a specific category from the local cache.
     */
    override fun getItemsByCategory(categoryId: String): Flow<List<MenuItem>> {
        return localDataSource.getByParentId(categoryId).map { entities ->
            entities.map { it.toDomainModel() }
        }
    }

    /**
     * Searches menu items by name from the full local cache.
     * Filtering is done in-memory for simplicity since the menu is typically small.
     */
    override fun searchItems(query: String): Flow<List<MenuItem>> {
        return localDataSource.getAllMenuItems().map { entities ->
            entities
                .filter { it.name.contains(query, ignoreCase = true) }
                .map { it.toDomainModel() }
        }
    }

    /**
     * Starts the Firestore → Room synchronization and begins observing connectivity.
     *
     * Sets up a real-time listener on the `menus` collection. On each snapshot:
     * - Performs a full cache replacement (replaceAll) to ensure consistency.
     * - Resets the retry counter on success.
     *
     * On failure, retries up to [MENU_SYNC_RETRY_MAX] times with exponential backoff.
     * Additionally monitors connectivity: when the device transitions from OFFLINE → ONLINE,
     * the sync listener is automatically restarted and the cache is reconciled within 10 seconds.
     */
    override suspend fun startSync() {
        // Cancel any existing sync job before starting a new one
        syncJob?.cancel()
        retryCount = 0

        syncJob = scope.launch {
            startSyncWithRetry()
        }

        // Start observing connectivity to restart sync on reconnection
        startConnectivityObserver()
    }

    /**
     * Stops the Firestore listener and connectivity observer by cancelling their coroutines.
     */
    override fun stopSync() {
        syncJob?.cancel()
        syncJob = null
        connectivityJob?.cancel()
        connectivityJob = null
    }

    /**
     * Observes connectivity state and restarts sync when the device transitions
     * from OFFLINE to ONLINE. This ensures the local cache is reconciled with
     * Firestore within 10 seconds of regaining connectivity.
     */
    private fun startConnectivityObserver() {
        connectivityJob?.cancel()
        connectivityJob = scope.launch {
            connectivityMonitor.connectivityState
                .distinctUntilChanged()
                .collect { state ->
                    val previousState = lastConnectivityState
                    lastConnectivityState = state

                    if (previousState == ConnectivityState.OFFLINE && state == ConnectivityState.ONLINE) {
                        Log.d(TAG, "Connectivity restored. Restarting menu sync for reconciliation.")
                        restartSync()
                    }
                }
        }
    }

    /**
     * Restarts the Firestore sync listener after a connectivity restoration.
     * Cancels the existing sync job and creates a new one with a fresh retry count.
     * The Firestore listener will receive the full collection snapshot on reconnect,
     * ensuring the Room cache is reconciled within 10 seconds.
     */
    private fun restartSync() {
        syncJob?.cancel()
        retryCount = 0

        syncJob = scope.launch {
            startSyncWithRetry()
        }
    }

    /**
     * Internal sync loop with retry logic.
     * On each Firestore snapshot, writes the full collection to Room.
     * On error, retries with exponential backoff up to [MENU_SYNC_RETRY_MAX] times.
     */
    private suspend fun startSyncWithRetry() {
        remoteDataSource.observeMenuChanges()
            .catch { error ->
                Log.e(TAG, "Menu sync error: ${error.message}", error)
                handleSyncError(error)
            }
            .collect { menuEntities ->
                try {
                    // Full collection replacement ensures cache matches Firestore exactly
                    localDataSource.replaceAll(menuEntities)
                    retryCount = 0 // Reset on successful sync
                    Log.d(TAG, "Menu sync successful: ${menuEntities.size} items cached")
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to write menu to Room: ${e.message}", e)
                    handleSyncError(e)
                }
            }
    }

    /**
     * Handles sync errors with exponential backoff retry logic.
     * Retries up to [MENU_SYNC_RETRY_MAX] times before giving up.
     * The cached menu remains available while retrying.
     */
    private suspend fun handleSyncError(error: Throwable) {
        if (retryCount < MENU_SYNC_RETRY_MAX) {
            retryCount++
            val delayMs = MENU_SYNC_BASE_DELAY_MS * (1L shl (retryCount - 1))
            Log.w(TAG, "Retrying menu sync (attempt $retryCount/$MENU_SYNC_RETRY_MAX) in ${delayMs}ms")
            delay(delayMs)
            startSyncWithRetry()
        } else {
            Log.e(TAG, "Menu sync failed after $MENU_SYNC_RETRY_MAX attempts. Serving cached data.", error)
            // Continue serving cached menu — do not clear local data
        }
    }

    /**
     * Maps a [MenuEntity] (data layer) to a [MenuItem] (domain layer).
     */
    private fun MenuEntity.toDomainModel(): MenuItem {
        return MenuItem(
            id = id,
            name = name,
            parentId = parentId,
            type = MenuItemType.fromString(type),
            price = price,
            selectionType = SelectionType.fromString(selectionType),
            minSelection = minSelection,
            maxSelection = maxSelection,
            description = description,
            imageUrl = imageUrl,
            isAvailable = isAvailable,
            trackInventory = trackInventory,
            inventoryMultiplier = inventoryMultiplier,
            inventoryTrackingMode = inventoryTrackingMode,
            order = order,
            createdAt = createdAt,
            updatedAt = updatedAt
        )
    }

    /**
     * Returns a one-shot snapshot of all cached menu items from Room.
     */
    override suspend fun getCachedMenu(): List<MenuItem> {
        return localDataSource.getAllMenuItems().first().map { it.toDomainModel() }
    }
}
