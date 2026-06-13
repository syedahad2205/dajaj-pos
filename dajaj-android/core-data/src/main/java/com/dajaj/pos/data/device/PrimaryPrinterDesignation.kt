package com.dajaj.pos.data.device

import android.util.Log
import com.dajaj.pos.common.Result
import com.dajaj.pos.data.di.DevicesCollection
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Manages primary printer designation across devices in a restaurant.
 *
 * Enforces the invariant that exactly one device can be the primary printer
 * at any given time. Uses Firestore transactions to atomically check-then-set
 * the isPrimaryPrinter flag, preventing race conditions when multiple devices
 * attempt designation concurrently.
 *
 * Key behaviors:
 * - Only one device per restaurant can hold isPrimaryPrinter=true
 * - If the primary device goes OFFLINE, the designation is left unassigned
 *   until a manual re-designation occurs (no auto-failover)
 * - Non-primary devices ignore PENDING print jobs from the Firestore listener
 *
 * Requirements: 10.5, 10.6, 10.7
 */
@Singleton
class PrimaryPrinterDesignation @Inject constructor(
    private val firestore: FirebaseFirestore,
    @DevicesCollection private val devicesCollection: CollectionReference
) {

    companion object {
        private const val TAG = "PrimaryPrinterDesignation"

        private const val FIELD_IS_PRIMARY_PRINTER = "isPrimaryPrinter"
        private const val FIELD_RESTAURANT_ID = "restaurantId"
    }

    /**
     * Attempts to designate the given device as the primary printer for the restaurant.
     *
     * Uses a Firestore transaction with a check-then-set pattern:
     * 1. Query all devices in the restaurant to get their document IDs
     * 2. Read each device doc within the transaction for consistency
     * 3. If no device has isPrimaryPrinter=true → set this device as primary → success
     * 4. If this device already has isPrimaryPrinter=true → no-op → success
     * 5. If another device has isPrimaryPrinter=true → reject → error
     *
     * @param deviceId The ID of the device requesting primary designation.
     * @param restaurantId The restaurant the device belongs to.
     * @return [Result.Success] if designation succeeded or was a no-op,
     *         [Result.Error] if another device already holds the primary designation.
     */
    suspend fun designateAsPrimary(deviceId: String, restaurantId: String): Result<Unit> {
        return try {
            // First, get all device IDs for this restaurant (outside transaction)
            val restaurantDevices = devicesCollection
                .whereEqualTo(FIELD_RESTAURANT_ID, restaurantId)
                .get()
                .await()

            val deviceDocIds = restaurantDevices.documents.map { it.id }

            // Run transaction reading all device docs to check primary status atomically
            firestore.runTransaction { transaction ->
                val deviceDocRef = devicesCollection.document(deviceId)

                // Read all restaurant device docs within the transaction for consistency
                var currentPrimaryId: String? = null
                for (docId in deviceDocIds) {
                    val docRef = devicesCollection.document(docId)
                    val docSnapshot = transaction.get(docRef)
                    val isPrimary = docSnapshot.getBoolean(FIELD_IS_PRIMARY_PRINTER) ?: false
                    if (isPrimary) {
                        currentPrimaryId = docId
                        break
                    }
                }

                when {
                    // No current primary — designate this device
                    currentPrimaryId == null -> {
                        transaction.update(deviceDocRef, FIELD_IS_PRIMARY_PRINTER, true)
                        Log.d(TAG, "Device $deviceId designated as primary printer for restaurant $restaurantId")
                    }

                    // Current primary is this device — no-op
                    currentPrimaryId == deviceId -> {
                        Log.d(TAG, "Device $deviceId is already the primary printer — no-op")
                    }

                    // Another device is the primary — reject
                    else -> {
                        throw PrimaryPrinterConflictException(
                            "Cannot designate device $deviceId as primary: " +
                                "device $currentPrimaryId already holds the designation"
                        )
                    }
                }
            }.await()

            Result.Success(Unit)
        } catch (e: PrimaryPrinterConflictException) {
            Log.w(TAG, "Primary printer designation rejected: ${e.message}")
            Result.Error(e.message ?: "Another device is already the primary printer", e)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to designate primary printer: ${e.message}", e)
            Result.Error("Failed to designate primary printer: ${e.message}", e)
        }
    }

    /**
     * Resigns the primary printer designation for the given device.
     *
     * Unsets the isPrimaryPrinter flag on this device's document. After this operation,
     * no device will be the primary printer until a manual re-designation occurs.
     *
     * @param deviceId The ID of the device resigning its primary designation.
     * @return [Result.Success] if the flag was cleared successfully,
     *         [Result.Error] if the operation failed.
     */
    suspend fun resignAsPrimary(deviceId: String): Result<Unit> {
        return try {
            devicesCollection.document(deviceId)
                .update(FIELD_IS_PRIMARY_PRINTER, false)
                .await()

            Log.d(TAG, "Device $deviceId resigned as primary printer")
            Result.Success(Unit)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to resign primary printer: ${e.message}", e)
            Result.Error("Failed to resign primary printer: ${e.message}", e)
        }
    }

    /**
     * Checks whether the given device is currently designated as the primary printer.
     *
     * Reads the device document directly and returns the isPrimaryPrinter flag value.
     *
     * @param deviceId The ID of the device to check.
     * @return `true` if the device is the primary printer, `false` otherwise
     *         (including when the document doesn't exist or the field is missing).
     */
    suspend fun isPrimaryPrinter(deviceId: String): Boolean {
        return try {
            val snapshot = devicesCollection.document(deviceId).get().await()
            snapshot?.getBoolean(FIELD_IS_PRIMARY_PRINTER) ?: false
        } catch (e: Exception) {
            Log.e(TAG, "Error checking primary printer status for device $deviceId: ${e.message}", e)
            false
        }
    }

    /**
     * Returns the device ID of the current primary printer for a restaurant, or null
     * if no device is currently designated as primary.
     *
     * @param restaurantId The restaurant to query.
     * @return The deviceId of the current primary printer, or `null` if none is designated.
     */
    suspend fun getCurrentPrimary(restaurantId: String): String? {
        return try {
            val snapshot = devicesCollection
                .whereEqualTo(FIELD_RESTAURANT_ID, restaurantId)
                .whereEqualTo(FIELD_IS_PRIMARY_PRINTER, true)
                .get()
                .await()

            if (snapshot.isEmpty) {
                Log.d(TAG, "No primary printer designated for restaurant $restaurantId")
                null
            } else {
                val primaryId = snapshot.documents[0].id
                Log.d(TAG, "Current primary printer for restaurant $restaurantId: $primaryId")
                primaryId
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error getting current primary for restaurant $restaurantId: ${e.message}", e)
            null
        }
    }
}

/**
 * Exception thrown when a primary printer designation is rejected because
 * another device already holds the primary designation.
 */
class PrimaryPrinterConflictException(message: String) : Exception(message)
