package com.dajaj.pos.data.repository

import android.util.Log
import com.dajaj.pos.domain.repository.SettingsRepository
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Implementation of [SettingsRepository] backed by Firestore.
 *
 * Reads settings from the `settings` collection in Firestore.
 * Favorite item IDs are stored in the `settings/favorites` document
 * as a string array field named "itemIds".
 *
 * If the document does not exist or the field is missing, an empty list is returned.
 */
@Singleton
class SettingsRepositoryImpl @Inject constructor(
    private val firestore: FirebaseFirestore
) : SettingsRepository {

    companion object {
        private const val TAG = "SettingsRepositoryImpl"
        private const val SETTINGS_COLLECTION = "settings"
        private const val FAVORITES_DOCUMENT = "favorites"
        private const val FIELD_ITEM_IDS = "itemIds"
    }

    /**
     * Observes the favorite item IDs from the `settings/favorites` Firestore document.
     *
     * Sets up a real-time snapshot listener on the document. On each snapshot:
     * - If the document exists and contains the "itemIds" field, emits the list of IDs.
     * - If the document doesn't exist or the field is missing, emits an empty list.
     *
     * @return A [Flow] of favorite item ID strings, updating in real-time.
     */
    override fun getFavoriteItemIds(): Flow<List<String>> = callbackFlow {
        val documentRef = firestore
            .collection(SETTINGS_COLLECTION)
            .document(FAVORITES_DOCUMENT)

        val listener = documentRef.addSnapshotListener { snapshot, error ->
            if (error != null) {
                Log.e(TAG, "Error listening to favorites settings: ${error.message}", error)
                trySend(emptyList())
                return@addSnapshotListener
            }

            if (snapshot != null && snapshot.exists()) {
                @Suppress("UNCHECKED_CAST")
                val itemIds = (snapshot.get(FIELD_ITEM_IDS) as? List<String>) ?: emptyList()
                Log.d(TAG, "Favorites loaded: ${itemIds.size} item IDs")
                trySend(itemIds)
            } else {
                Log.d(TAG, "Favorites document does not exist, returning empty list")
                trySend(emptyList())
            }
        }

        awaitClose {
            listener.remove()
            Log.d(TAG, "Favorites listener removed")
        }
    }
}
