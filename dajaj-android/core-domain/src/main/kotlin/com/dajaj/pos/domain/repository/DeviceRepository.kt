package com.dajaj.pos.domain.repository

import com.dajaj.pos.common.Result
import kotlinx.coroutines.flow.Flow

/**
 * Repository interface for device registry operations.
 *
 * Manages device registration, heartbeat updates, primary printer designation,
 * and real-time observation of connected devices. Implementations handle
 * Firestore transactions for atomic primary designation and heartbeat staleness checks.
 */
interface DeviceRepository {

    /**
     * Registers this device in the device registry with status ONLINE.
     * Called on application start. Retries up to 5 times on failure.
     *
     * @param name Display name for the device (max 50 chars)
     * @return Result indicating success or failure
     */
    suspend fun registerDevice(name: String): Result<Unit>

    /**
     * Updates the heartbeat timestamp for this device in Firestore.
     * Called every 30 seconds while the app is running.
     *
     * @return Result indicating success or failure
     */
    suspend fun updateHeartbeat(): Result<Unit>

    /**
     * Designates a device as the primary printer node using a Firestore transaction.
     * Only one device can be primary at a time; the operation fails if another device
     * already holds the designation.
     *
     * @param deviceId The device to designate as primary
     * @return Result indicating success or failure
     */
    suspend fun designatePrimary(deviceId: String): Result<Unit>

    /**
     * Observes all registered devices as a reactive Flow.
     * Emits updated device list on any status or heartbeat change.
     */
    fun observeDevices(): Flow<List<DeviceInfo>>

    /**
     * Observes this device's info as a reactive Flow.
     * Emits updated info on any status or heartbeat change.
     */
    fun observeMyDevice(): Flow<DeviceInfo?>

    /**
     * Returns this device's unique identifier.
     */
    fun getMyDeviceId(): String

    /**
     * Updates the display name of this device (max 50 characters).
     *
     * @param name New device name
     * @return Result indicating success or failure
     */
    suspend fun updateDeviceName(name: String): Result<Unit>
}

/**
 * Data class representing a registered device in the ecosystem.
 */
data class DeviceInfo(
    val id: String,
    val deviceName: String,
    val isPrimaryPrinter: Boolean,
    val status: DeviceStatus,
    val lastHeartbeat: Long,
    val registeredAt: Long
)

enum class DeviceStatus {
    ONLINE,
    OFFLINE
}
