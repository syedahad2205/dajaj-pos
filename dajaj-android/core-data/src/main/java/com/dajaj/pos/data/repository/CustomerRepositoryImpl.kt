package com.dajaj.pos.data.repository

import android.util.Log
import com.dajaj.pos.common.Result
import com.dajaj.pos.common.network.ConnectivityMonitor
import com.dajaj.pos.data.di.CustomersCollection
import com.dajaj.pos.data.local.dao.CustomerDao
import com.dajaj.pos.data.local.entity.CustomerEntity
import com.dajaj.pos.domain.repository.CustomerInfo
import com.dajaj.pos.domain.repository.CustomerRepository
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.SetOptions
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeout
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Implementation of [CustomerRepository] using Firestore for remote persistence
 * and Room (via [CustomerDao]) for local caching and quick lookups.
 *
 * Customer records are keyed by phone number (10-digit Indian mobile).
 *
 * Strategy:
 * - [searchByPhone]: Queries Firestore first (with 2-second timeout) for auto-fill.
 *   Falls back to Room local cache if network is unavailable or the query times out.
 * - [createOrUpdate]: Upserts to both Firestore and Room when online. If offline,
 *   persists to Room immediately so the cashier can proceed; the record will be
 *   synced to Firestore when connectivity is restored (via SyncManager).
 * - Default "Walk-in Customer" with empty phone is handled at the domain/use-case
 *   layer when no customer details are provided.
 */
@Singleton
class CustomerRepositoryImpl @Inject constructor(
    @CustomersCollection private val customersCollection: CollectionReference,
    private val customerDao: CustomerDao,
    private val connectivityMonitor: ConnectivityMonitor
) : CustomerRepository {

    companion object {
        private const val TAG = "CustomerRepo"
        private const val SEARCH_TIMEOUT_MS = 2000L
        private const val FIELD_NAME = "name"
        private const val FIELD_PHONE = "phone"
        private const val FIELD_LAST_ORDER_AT = "lastOrderAt"
        private const val FIELD_CREATED_AT = "createdAt"
    }

    /**
     * Searches for a customer by exact phone number.
     *
     * Online: Queries Firestore customers collection (document ID = phone) with a
     * 2-second timeout. On success, caches the result in Room for offline access.
     *
     * Offline/Timeout: Falls back to Room local cache transparently.
     */
    override suspend fun searchByPhone(phone: String): Result<CustomerInfo?> {
        if (phone.isBlank()) {
            return Result.Success(null)
        }

        return if (connectivityMonitor.isCurrentlyConnected()) {
            searchFromFirestoreWithFallback(phone)
        } else {
            Log.d(TAG, "Offline — searching Room for phone: $phone")
            searchFromRoom(phone)
        }
    }

    /**
     * Creates a new customer or updates an existing one (upsert by phone).
     *
     * Online: Writes to Firestore (merge strategy so existing fields aren't lost)
     * and to Room for local cache consistency.
     *
     * Offline: Persists to Room immediately so the cashier can proceed without
     * waiting for network. The record is queued for Firestore sync when online.
     */
    override suspend fun createOrUpdate(customer: CustomerInfo): Result<Unit> {
        return try {
            val now = System.currentTimeMillis()
            val entityToSave = customer.toEntity().copy(lastOrderAt = now)

            // Always persist locally first (zero data loss guarantee)
            customerDao.upsert(entityToSave)
            Log.d(TAG, "Customer saved to Room: ${customer.phone}")

            if (connectivityMonitor.isCurrentlyConnected()) {
                try {
                    val data = mapOf(
                        FIELD_NAME to customer.name,
                        FIELD_PHONE to customer.phone,
                        FIELD_LAST_ORDER_AT to now,
                        FIELD_CREATED_AT to customer.createdAt
                    )
                    // Merge: creates if phone doc doesn't exist, updates name + lastOrderAt if it does
                    customersCollection.document(customer.phone)
                        .set(data, SetOptions.merge())
                        .await()
                    Log.d(TAG, "Customer synced to Firestore: ${customer.phone}")
                } catch (e: Exception) {
                    // Firestore write failed but Room has the data — cashier can proceed
                    Log.w(TAG, "Firestore upsert failed for ${customer.phone}, queued locally", e)
                }
            } else {
                Log.d(TAG, "Offline — customer ${customer.phone} queued in Room for sync")
            }

            Result.Success(Unit)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to create/update customer: ${customer.phone}", e)
            Result.Error(e.message ?: "Customer create/update failed", e)
        }
    }

    override suspend fun search(query: String): Result<List<CustomerInfo>> {
        return try {
            val entities = customerDao.search(query)
            Result.Success(entities.map { it.toDomain() })
        } catch (e: Exception) {
            Result.Error(e.message ?: "Customer search failed", e)
        }
    }

    override fun observeRecentCustomers(limit: Int): Flow<List<CustomerInfo>> {
        return customerDao.getRecentCustomers(limit).map { entities ->
            entities.map { it.toDomain() }
        }
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    /**
     * Attempts Firestore lookup with 2-second timeout.
     * On any failure (timeout, network error), falls back to Room.
     */
    private suspend fun searchFromFirestoreWithFallback(phone: String): Result<CustomerInfo?> {
        return try {
            val customer = withTimeout(SEARCH_TIMEOUT_MS) {
                val snapshot = customersCollection.document(phone).get().await()
                if (snapshot.exists()) {
                    mapSnapshotToCustomerInfo(snapshot.data, phone)
                } else {
                    null
                }
            }

            // Cache in Room for future offline lookups
            if (customer != null) {
                try {
                    customerDao.upsert(customer.toEntity())
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to cache customer in Room", e)
                }
            }

            Result.Success(customer)
        } catch (e: Exception) {
            Log.w(TAG, "Firestore search failed/timed out for $phone, falling back to Room", e)
            searchFromRoom(phone)
        }
    }

    /**
     * Searches Room local cache for a customer by phone.
     */
    private suspend fun searchFromRoom(phone: String): Result<CustomerInfo?> {
        return try {
            val entity = customerDao.getByPhone(phone)
            Result.Success(entity?.toDomain())
        } catch (e: Exception) {
            Log.e(TAG, "Room search failed for $phone", e)
            Result.Error(e.message ?: "Room search failed for $phone", e)
        }
    }

    /**
     * Maps a Firestore document's data map to [CustomerInfo].
     */
    private fun mapSnapshotToCustomerInfo(
        data: Map<String, Any>?,
        phone: String
    ): CustomerInfo? {
        if (data == null) return null
        val name = data[FIELD_NAME] as? String ?: return null
        val lastOrderAt = (data[FIELD_LAST_ORDER_AT] as? Number)?.toLong()
        val createdAt = (data[FIELD_CREATED_AT] as? Number)?.toLong()
            ?: System.currentTimeMillis()
        return CustomerInfo(
            name = name,
            phone = phone,
            lastOrderAt = lastOrderAt,
            createdAt = createdAt
        )
    }

    private fun CustomerEntity.toDomain(): CustomerInfo {
        return CustomerInfo(
            name = name,
            phone = phone,
            lastOrderAt = lastOrderAt,
            createdAt = createdAt
        )
    }

    private fun CustomerInfo.toEntity(): CustomerEntity {
        return CustomerEntity(
            phone = phone,
            name = name,
            lastOrderAt = lastOrderAt,
            createdAt = createdAt
        )
    }
}
