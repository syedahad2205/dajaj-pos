package com.dajaj.pos.data.repository

import android.util.Log
import com.dajaj.pos.common.Result
import com.dajaj.pos.domain.repository.SettingsRepository
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.SetOptions
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Implementation of [SettingsRepository] backed by Firestore.
 *
 * Reads settings from the `settings` collection in Firestore.
 */
@Singleton
class SettingsRepositoryImpl @Inject constructor(
    private val firestore: FirebaseFirestore
) : SettingsRepository {

    companion object {
        private const val TAG = "SettingsRepositoryImpl"
        private const val SETTINGS_COLLECTION = "settings"
        private const val FAVORITES_DOCUMENT = "favorites"
        private const val RATES_DOCUMENT = "rates"
        private const val FIELD_ITEM_IDS = "itemIds"
        private const val FIELD_TAX_RATE = "taxRate"
        private const val FIELD_SERVICE_CHARGE = "serviceChargeRate"
        private const val DEFAULT_TAX_RATE = 2.5
        private const val DEFAULT_SERVICE_CHARGE = 0.0
    }

    // ── Favorites ─────────────────────────────────────────────────────────────

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
                trySend(itemIds)
            } else {
                trySend(emptyList())
            }
        }

        awaitClose { listener.remove() }
    }

    override suspend fun updateFavoriteItemIds(itemIds: List<String>): Result<Unit> {
        return try {
            firestore.collection(SETTINGS_COLLECTION)
                .document(FAVORITES_DOCUMENT)
                .set(mapOf(FIELD_ITEM_IDS to itemIds), SetOptions.merge())
                .await()
            Result.Success(Unit)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to update favorites: ${e.message}", e)
            Result.Error("Failed to update favorites: ${e.message}", e)
        }
    }

    // ── Tax Rate ──────────────────────────────────────────────────────────────

    override fun getTaxRate(): Flow<Double> = callbackFlow {
        val docRef = firestore.collection(SETTINGS_COLLECTION).document(RATES_DOCUMENT)
        val listener = docRef.addSnapshotListener { snapshot, error ->
            if (error != null) {
                trySend(DEFAULT_TAX_RATE)
                return@addSnapshotListener
            }
            val rate = (snapshot?.get(FIELD_TAX_RATE) as? Number)?.toDouble() ?: DEFAULT_TAX_RATE
            trySend(rate)
        }
        awaitClose { listener.remove() }
    }

    override suspend fun updateTaxRate(rate: Double): Result<Unit> {
        return try {
            firestore.collection(SETTINGS_COLLECTION)
                .document(RATES_DOCUMENT)
                .set(mapOf(FIELD_TAX_RATE to rate), SetOptions.merge())
                .await()
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error("Failed to update tax rate: ${e.message}", e)
        }
    }

    // ── Service Charge ────────────────────────────────────────────────────────

    override fun getServiceChargeRate(): Flow<Double> = callbackFlow {
        val docRef = firestore.collection(SETTINGS_COLLECTION).document(RATES_DOCUMENT)
        val listener = docRef.addSnapshotListener { snapshot, error ->
            if (error != null) {
                trySend(DEFAULT_SERVICE_CHARGE)
                return@addSnapshotListener
            }
            val rate = (snapshot?.get(FIELD_SERVICE_CHARGE) as? Number)?.toDouble() ?: DEFAULT_SERVICE_CHARGE
            trySend(rate)
        }
        awaitClose { listener.remove() }
    }

    override suspend fun updateServiceChargeRate(rate: Double): Result<Unit> {
        return try {
            firestore.collection(SETTINGS_COLLECTION)
                .document(RATES_DOCUMENT)
                .set(mapOf(FIELD_SERVICE_CHARGE to rate), SetOptions.merge())
                .await()
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error("Failed to update service charge: ${e.message}", e)
        }
    }

    // ── App Info ──────────────────────────────────────────────────────────────

    override fun getAppVersion(): String {
        return try {
            val packageInfo = com.dajaj.pos.data.repository.SettingsRepositoryImpl::class.java
                .`package`?.name ?: ""
            // Fallback: return a static version string since BuildConfig is module-scoped
            "1.0.0"
        } catch (e: Exception) {
            "1.0.0"
        }
    }
}
