package com.dajaj.pos.domain.model

/**
 * Domain model representing a registered Android POS device in the device registry.
 *
 * Devices are tracked via Firestore `devices` collection for monitoring
 * and primary printer designation. Heartbeat staleness (>90s) marks device OFFLINE.
 */
data class DeviceInfo(
    /** Unique device identifier (Firestore document ID). */
    val deviceId: String,

    /** Human-friendly device name (max 50 chars). */
    val deviceName: String,

    /** Whether this device is the designated primary printer. At most one per restaurant. */
    val isPrimaryPrinter: Boolean,

    /** Current online/offline status based on heartbeat freshness. */
    val status: DeviceStatus,

    /** Timestamp of the last heartbeat update (epoch millis). */
    val lastHeartbeat: Long
)
