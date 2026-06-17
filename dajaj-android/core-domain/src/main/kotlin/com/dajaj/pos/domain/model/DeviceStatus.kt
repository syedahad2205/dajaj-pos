package com.dajaj.pos.domain.model

/**
 * Represents the online/offline status of a registered Android POS device.
 *
 * Status is determined by heartbeat staleness (>90 seconds → OFFLINE).
 */
enum class DeviceStatus {
    /** Device heartbeat is current (within 90 seconds). */
    ONLINE,

    /** Device heartbeat is stale or device has been deregistered. */
    OFFLINE;

    companion object {
        fun fromString(value: String): DeviceStatus = when (value.lowercase()) {
            "online" -> ONLINE
            "offline" -> OFFLINE
            else -> OFFLINE
        }
    }

    fun toFirestoreValue(): String = when (this) {
        ONLINE -> "online"
        OFFLINE -> "offline"
    }
}
