package com.dajaj.pos.data.device

import android.content.Context
import android.os.Build
import android.provider.Settings
import android.util.Log
import com.dajaj.pos.common.Constants
import com.dajaj.pos.data.di.DevicesCollection
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.SetOptions
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Service responsible for registering this Android POS device in the Firestore
 * `devices` collection on app start.
 *
 * Stores:
 * - deviceId (Android ID)
 * - deviceName (model name, max 50 chars)
 * - isPrimaryPrinter flag (defaults to false on first registration)
 * - lastHeartbeat (current server timestamp)
 * - status (ONLINE)
 * - userId (the authenticated user operating this device)
 * - printerStatus (map of connected printer states)
 * - appVersion (BuildConfig version name)
 *
 * Uses [SetOptions.merge] so that existing fields (like isPrimaryPrinter) are not
 * overwritten on subsequent app starts.
 */
@Singleton
class DeviceRegistrationService @Inject constructor(
    @ApplicationContext private val context: Context,
    @DevicesCollection private val devicesCollection: CollectionReference
) {

    companion object {
        private const val TAG = "DeviceRegistration"

        // Firestore field names for the devices collection
        const val FIELD_DEVICE_ID = "deviceId"
        const val FIELD_DEVICE_NAME = "deviceName"
        const val FIELD_IS_PRIMARY_PRINTER = "isPrimaryPrinter"
        const val FIELD_LAST_HEARTBEAT = "lastHeartbeat"
        const val FIELD_STATUS = "status"
        const val FIELD_USER_ID = "userId"
        const val FIELD_PRINTER_STATUS = "printerStatus"
        const val FIELD_APP_VERSION = "appVersion"
        const val FIELD_RESTAURANT_ID = "restaurantId"
        const val FIELD_REGISTERED_AT = "registeredAt"

        const val STATUS_ONLINE = "online"
        const val STATUS_OFFLINE = "offline"

        private const val MAX_DEVICE_NAME_LENGTH = 50
    }

    /**
     * Returns the unique device ID (Android Secure ID) for this device.
     */
    val deviceId: String
        get() = Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ANDROID_ID
        )

    /**
     * Returns a human-readable device name derived from the device model.
     * Truncated to 50 characters per requirement 10.1.
     */
    val deviceName: String
        get() {
            val manufacturer = Build.MANUFACTURER.replaceFirstChar { it.uppercase() }
            val model = Build.MODEL
            val name = if (model.startsWith(manufacturer, ignoreCase = true)) {
                model
            } else {
                "$manufacturer $model"
            }
            return name.take(MAX_DEVICE_NAME_LENGTH)
        }

    /**
     * Registers this device in the Firestore `devices` collection with status ONLINE
     * and a current heartbeat timestamp.
     *
     * Uses merge semantics so existing fields (like isPrimaryPrinter set by an operator)
     * are preserved across app restarts.
     *
     * @param userId The authenticated user's ID operating this device.
     * @param appVersion The current app version string (e.g., "1.0.0").
     * @param restaurantId The restaurant this device belongs to.
     * @return `true` if registration succeeded, `false` otherwise.
     */
    suspend fun registerDevice(
        userId: String,
        appVersion: String,
        restaurantId: String = "dajaj_main"
    ): Boolean {
        return try {
            val deviceData = mapOf(
                FIELD_DEVICE_ID to deviceId,
                FIELD_DEVICE_NAME to deviceName,
                FIELD_LAST_HEARTBEAT to FieldValue.serverTimestamp(),
                FIELD_STATUS to STATUS_ONLINE,
                FIELD_USER_ID to userId,
                FIELD_APP_VERSION to appVersion,
                FIELD_RESTAURANT_ID to restaurantId,
                FIELD_REGISTERED_AT to FieldValue.serverTimestamp()
            )

            // Merge so we don't overwrite isPrimaryPrinter or printerStatus if already set
            devicesCollection.document(deviceId)
                .set(deviceData, SetOptions.merge())
                .await()

            Log.d(TAG, "Device registered: $deviceId ($deviceName)")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to register device: ${e.message}", e)
            false
        }
    }

    /**
     * Updates the heartbeat timestamp and status to ONLINE for this device.
     * Called periodically (every 30 seconds) by the heartbeat coroutine loop.
     *
     * @return `true` if the heartbeat update succeeded, `false` otherwise.
     */
    suspend fun updateHeartbeat(): Boolean {
        return try {
            devicesCollection.document(deviceId)
                .update(
                    mapOf(
                        FIELD_LAST_HEARTBEAT to FieldValue.serverTimestamp(),
                        FIELD_STATUS to STATUS_ONLINE
                    )
                )
                .await()

            Log.d(TAG, "Heartbeat updated for device: $deviceId")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to update heartbeat: ${e.message}", e)
            false
        }
    }

    /**
     * Sets the device status to OFFLINE. Called when the service is stopping.
     */
    suspend fun markOffline() {
        try {
            devicesCollection.document(deviceId)
                .update(FIELD_STATUS, STATUS_OFFLINE)
                .await()

            Log.d(TAG, "Device marked offline: $deviceId")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to mark device offline: ${e.message}", e)
        }
    }
}
