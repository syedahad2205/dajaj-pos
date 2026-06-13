package com.dajaj.pos.domain.repository

import kotlinx.coroutines.flow.Flow

/**
 * Repository interface for application settings and preferences.
 *
 * Provides access to configurable settings stored in Firestore,
 * such as favorite menu item IDs managed by the restaurant manager.
 */
interface SettingsRepository {

    /**
     * Observes the list of favorite menu item IDs from the settings document.
     *
     * The favorites are stored in Firestore at `settings/favorites` as a string array
     * field named "itemIds". If the document does not exist, an empty list is returned.
     *
     * @return A [Flow] emitting the current list of favorite item IDs,
     *         updating in real-time when the settings document changes.
     */
    fun getFavoriteItemIds(): Flow<List<String>>
}
