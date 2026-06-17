package com.dajaj.pos.data.repository

import android.content.Context
import android.provider.Settings
import android.util.Log
import com.dajaj.pos.common.Constants
import com.dajaj.pos.common.Result
import com.dajaj.pos.data.device.DeviceRegistrationService
import com.dajaj.pos.data.device.DeviceStatusEvaluator
import com.dajaj.pos.data.device.PrimaryPrinterDesignation
import com.dajaj.pos.data.di.DevicesCollection
import com.dajaj.pos.domain.repository.DeviceInfo
import com.dajaj.pos.domain.repository.DeviceRepository
import com.dajaj.pos.domain.repository.DeviceStatus
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.SetOptions
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Implementation of [DeviceRepository] using Firestore for device registry.
 *
 * Delegates to existing device management services:
 * - [DeviceRegistrationService] for registration and heartbeat updates
 * - [PrimaryPrinterDesignation] for atomic primary printer transactions
 * - [DeviceStatusEvaluator] for staleness detection
 *
 * Adds the following repository-level behaviors:
 * - Registration retry: 5 attempts with exponential backoff (5s base)
 * - Max 10 devices per restaurant enforcement
 * - OFFLINE device rejection for primary designation
 * - Automatic primary designation clearing when device goes OFFLINE
 * - Real-time device observation with staleness evaluation
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8
 */
@Singleton
class DeviceRepositoryImpl @Inject constructor(
    @ApplicationContext private val context: Context,
    @DevicesCollection private val devicesCollection: CollectionReference,
    private val firestore: FirebaseFirestore,
    private val deviceRegistrationService: DeviceRegistrationService,
    private val primaryPrinterDesignation: PrimaryPrinterDesignation,
    private val deviceStatusEvaluator: DeviceStatusEvaluator
) : DeviceRepository {

    companion object {
        private const val TAG = "DeviceRepositoryImpl"

        /** Maximum registration retry attempts (Requirement 10.1). */
        private const val MAX_REGISTRATION_RETRIES = 5

        /** Base delay for exponential backoff on registration (5 seconds). */
        private const val REGISTRATION_BACKOFF_BASE_MS = 5_000L

        /** Maximum devices per restaurant (Requirement 10.8). */
        private const val MAX_DEVICES_PER_RESTAURANT = 10

        /** Hardcoded restaurant ID — single-tenant deployment. */
        private const val RESTAURANT_ID = "dajaj_main"
    }

    private val deviceId: String by lazy {
        Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
    }

    /**
     * Registers this device in the Firestore `devices` collection with status ONLINE
     * and a current heartbeat timestamp.
     *
     * Enforcement:
     * - Max 10 devices per restaurant (Requirement 10.8). If the limit is reached and
     *   this device is not already registered, returns an error.
     * - Retries up to 5 times with exponential backoff (5s, 10s, 20s, 40s, 80s) on
     *   transient failures (Requirement 10.1).
     * - Uses merge semantics to preserve existing fields like isPrimaryPrinter.
     *
     * @param name Display name for the device (truncated to 50 chars)
     * @return [Result.Success] on successful registration, [Result.Error] on failure.
     */
    override suspend fun registerDevice(name: String): Result<Unit> {
        val truncatedName = name.take(50)

        for (attempt in 0 until MAX_REGISTRATION_RETRIES) {
            try {
                // Check max devices limit before registering
                val existingDevices = devicesCollection
                    .whereEqualTo(DeviceRegistrationService.FIELD_RESTAURANT_ID, RESTAURANT_ID)
                    .get()
                    .await()

                val existingDeviceIds = existingDevices.documents.map { it.id }
                val isAlreadyRegistered = existingDeviceIds.contains(deviceId)

                if (!isAlreadyRegistered && existingDeviceIds.size >= MAX_DEVICES_PER_RESTAURANT) {
                    return Result.Error(
                        "Maximum device limit reached ($MAX_DEVICES_PER_RESTAURANT devices per restaurant)"
                    )
                }

                // Register with merge semantics to preserve isPrimaryPrinter if already set
                val deviceData = mapOf(
                    DeviceRegistrationService.FIELD_DEVICE_ID to deviceId,
                    DeviceRegistrationService.FIELD_DEVICE_NAME to truncatedName,
                    DeviceRegistrationService.FIELD_LAST_HEARTBEAT to FieldValue.serverTimestamp(),
                    DeviceRegistrationService.FIELD_STATUS to DeviceRegistrationService.STATUS_ONLINE,
                    DeviceRegistrationService.FIELD_RESTAURANT_ID to RESTAURANT_ID,
                    DeviceRegistrationService.FIELD_REGISTERED_AT to FieldValue.serverTimestamp()
                )

                devicesCollection.document(deviceId)
                    .set(deviceData, SetOptions.merge())
                    .await()

                Log.d(TAG, "Device registered successfully: $deviceId ($truncatedName)")
                return Result.Success(Unit)
            } catch (e: Exception) {
                Log.w(
                    TAG,
                    "Registration attempt ${attempt + 1}/$MAX_REGISTRATION_RETRIES failed: ${e.message}"
                )

                if (attempt < MAX_REGISTRATION_RETRIES - 1) {
                    val backoffDelay = REGISTRATION_BACKOFF_BASE_MS * (1L shl attempt)
                    Log.d(TAG, "Retrying in ${backoffDelay}ms...")
                    delay(backoffDelay)
                } else {
                    Log.e(TAG, "All registration attempts exhausted", e)
                    return Result.Error(
                        "Device registration failed after $MAX_REGISTRATION_RETRIES attempts: ${e.message}",
                        e
                    )
                }
            }
        }

        // Should not reach here, but satisfy compiler
        return Result.Error("Device registration failed unexpectedly")
    }

    /**
     * Updates the heartbeat timestamp for this device in Firestore.
     * Delegates to [DeviceRegistrationService.updateHeartbeat] which sets
     * `lastHeartbeat` to server timestamp and `status` to ONLINE.
     *
     * Called every 30 seconds by the heartbeat loop (Requirement 10.2/10.3).
     *
     * @return [Result.Success] if update succeeded, [Result.Error] otherwise.
     */
    override suspend fun updateHeartbeat(): Result<Unit> {
        return try {
            val success = deviceRegistrationService.updateHeartbeat()
            if (success) {
                Result.Success(Unit)
            } else {
                Result.Error("Heartbeat update failed")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Heartbeat update error: ${e.message}", e)
            Result.Error("Heartbeat update error: ${e.message}", e)
        }
    }

    /**
     * Designates a device as the primary printer using a Firestore transaction.
     *
     * Enforcement (Requirements 10.5, 10.6, 10.7):
     * - Rejects if the target device is OFFLINE (staleness > 90s).
     * - Rejects if another device already holds the primary designation.
     * - Uses [PrimaryPrinterDesignation] for atomic check-then-set.
     * - If the current primary device has gone OFFLINE, clears its designation
     *   before attempting the new designation.
     *
     * @param deviceId The device to designate as primary.
     * @return [Result.Success] if designation succeeded, [Result.Error] on conflict or OFFLINE target.
     */
    override suspend fun designatePrimary(deviceId: String): Result<Unit> {
        return try {
            // Read the target device to check its status
            val targetDoc = devicesCollection.document(deviceId).get().await()

            if (!targetDoc.exists()) {
                return Result.Error("Device $deviceId not found")
            }

            // Check if target device is OFFLINE via staleness detection
            val lastHeartbeat = targetDoc.getTimestamp(DeviceRegistrationService.FIELD_LAST_HEARTBEAT)
            val lastHeartbeatMillis = lastHeartbeat?.toDate()?.time ?: 0L

            if (deviceStatusEvaluator.isDeviceOffline(lastHeartbeatMillis)) {
                return Result.Error(
                    "Cannot designate OFFLINE device as primary. " +
                        "Device $deviceId heartbeat is stale (>${Constants.DEVICE_OFFLINE_THRESHOLD_MS / 1000}s)."
                )
            }

            // If the current primary is OFFLINE, clear its designation first (Requirement 10.6)
            val currentPrimary = primaryPrinterDesignation.getCurrentPrimary(RESTAURANT_ID)
            if (currentPrimary != null && currentPrimary != deviceId) {
                val primaryDoc = devicesCollection.document(currentPrimary).get().await()
                val primaryHeartbeat = primaryDoc.getTimestamp(DeviceRegistrationService.FIELD_LAST_HEARTBEAT)
                val primaryHeartbeatMillis = primaryHeartbeat?.toDate()?.time ?: 0L

                if (deviceStatusEvaluator.isDeviceOffline(primaryHeartbeatMillis)) {
                    Log.d(TAG, "Current primary $currentPrimary is OFFLINE, clearing designation")
                    primaryPrinterDesignation.resignAsPrimary(currentPrimary)
                }
            }

            // Attempt designation via transactional service
            primaryPrinterDesignation.designateAsPrimary(deviceId, RESTAURANT_ID)
        } catch (e: Exception) {
            Log.e(TAG, "designatePrimary error: ${e.message}", e)
            Result.Error("Failed to designate primary: ${e.message}", e)
        }
    }

    /**
     * Observes all registered devices for this restaurant as a reactive Flow.
     *
     * Emits an updated device list on any change in the `devices` collection.
     * Applies staleness evaluation: devices with lastHeartbeat > 90s are reported
     * with status OFFLINE regardless of their stored status field (Requirement 10.4).
     *
     * Also handles primary-goes-OFFLINE clearing (Requirement 10.6): if the primary
     * device is detected as stale, its isPrimaryPrinter flag is cleared.
     *
     * @return Flow emitting the current list of [DeviceInfo] on each snapshot.
     */
    override fun observeDevices(): Flow<List<DeviceInfo>> = callbackFlow {
        var registration: ListenerRegistration? = null

        registration = devicesCollection
            .whereEqualTo(DeviceRegistrationService.FIELD_RESTAURANT_ID, RESTAURANT_ID)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    Log.e(TAG, "observeDevices snapshot error: ${error.message}", error)
                    close(error)
                    return@addSnapshotListener
                }

                val devices = snapshot?.documents?.mapNotNull { doc ->
                    try {
                        val heartbeatTimestamp = doc.getTimestamp(
                            DeviceRegistrationService.FIELD_LAST_HEARTBEAT
                        )
                        val lastHeartbeatMillis = heartbeatTimestamp?.toDate()?.time ?: 0L
                        val registeredAtTimestamp = doc.getTimestamp(
                            DeviceRegistrationService.FIELD_REGISTERED_AT
                        )
                        val registeredAtMillis = registeredAtTimestamp?.toDate()?.time ?: 0L

                        // Evaluate status client-side based on heartbeat staleness
                        val evaluatedStatus = if (deviceStatusEvaluator.isDeviceOffline(lastHeartbeatMillis)) {
                            DeviceStatus.OFFLINE
                        } else {
                            DeviceStatus.ONLINE
                        }

                        val isPrimary = doc.getBoolean(
                            DeviceRegistrationService.FIELD_IS_PRIMARY_PRINTER
                        ) ?: false

                        // If primary device is OFFLINE, clear its designation (Requirement 10.6)
                        if (isPrimary && evaluatedStatus == DeviceStatus.OFFLINE) {
                            // Fire and forget — clear the designation asynchronously
                            devicesCollection.document(doc.id)
                                .update(DeviceRegistrationService.FIELD_IS_PRIMARY_PRINTER, false)
                        }

                        DeviceInfo(
                            id = doc.id,
                            deviceName = doc.getString(DeviceRegistrationService.FIELD_DEVICE_NAME) ?: "",
                            isPrimaryPrinter = isPrimary && evaluatedStatus != DeviceStatus.OFFLINE,
                            status = evaluatedStatus,
                            lastHeartbeat = lastHeartbeatMillis,
                            registeredAt = registeredAtMillis
                        )
                    } catch (e: Exception) {
                        Log.w(TAG, "Error parsing device document ${doc.id}: ${e.message}")
                        null
                    }
                } ?: emptyList()

                trySend(devices)
            }

        awaitClose {
            registration?.remove()
        }
    }

    /**
     * Returns this device's unique identifier (Android Secure ID).
     */
    override fun getMyDeviceId(): String = deviceId

    /**
     * Observes this device's info as a reactive Flow.
     * Emits updated info whenever this device's document changes.
     */
    override fun observeMyDevice(): Flow<DeviceInfo?> = callbackFlow {
        val registration = devicesCollection.document(deviceId)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    Log.e(TAG, "observeMyDevice snapshot error: ${error.message}", error)
                    trySend(null)
                    return@addSnapshotListener
                }

                if (snapshot == null || !snapshot.exists()) {
                    trySend(null)
                    return@addSnapshotListener
                }

                try {
                    val heartbeatTimestamp = snapshot.getTimestamp(
                        DeviceRegistrationService.FIELD_LAST_HEARTBEAT
                    )
                    val lastHeartbeatMillis = heartbeatTimestamp?.toDate()?.time ?: 0L
                    val registeredAtTimestamp = snapshot.getTimestamp(
                        DeviceRegistrationService.FIELD_REGISTERED_AT
                    )
                    val registeredAtMillis = registeredAtTimestamp?.toDate()?.time ?: 0L

                    val evaluatedStatus = if (deviceStatusEvaluator.isDeviceOffline(lastHeartbeatMillis)) {
                        DeviceStatus.OFFLINE
                    } else {
                        DeviceStatus.ONLINE
                    }

                    val isPrimary = snapshot.getBoolean(
                        DeviceRegistrationService.FIELD_IS_PRIMARY_PRINTER
                    ) ?: false

                    val device = DeviceInfo(
                        id = snapshot.id,
                        deviceName = snapshot.getString(DeviceRegistrationService.FIELD_DEVICE_NAME) ?: "",
                        isPrimaryPrinter = isPrimary,
                        status = evaluatedStatus,
                        lastHeartbeat = lastHeartbeatMillis,
                        registeredAt = registeredAtMillis
                    )
                    trySend(device)
                } catch (e: Exception) {
                    Log.w(TAG, "Error parsing my device document: ${e.message}")
                    trySend(null)
                }
            }

        awaitClose { registration.remove() }
    }

    /**
     * Updates the display name of this device (max 50 characters).
     *
     * @param name New device name (truncated to 50 chars)
     * @return Result indicating success or failure
     */
    override suspend fun updateDeviceName(name: String): Result<Unit> {
        val truncatedName = name.take(50)

        return try {
            devicesCollection.document(deviceId)
                .update(DeviceRegistrationService.FIELD_DEVICE_NAME, truncatedName)
                .await()
            Log.d(TAG, "Device name updated to: $truncatedName")
            Result.Success(Unit)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to update device name: ${e.message}", e)
            Result.Error("Failed to update device name: ${e.message}", e)
        }
    }
}
