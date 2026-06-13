package com.dajaj.pos.bluetooth.model

/**
 * Represents a paired Bluetooth thermal printer with its current state and assigned role.
 */
data class PrinterInfo(
    /** Unique identifier for this printer (typically stored in local preferences). */
    val id: String,

    /** Human-readable printer name. */
    val name: String,

    /** Bluetooth MAC address (format: XX:XX:XX:XX:XX:XX). */
    val macAddress: String,

    /** Whether the printer is currently connected. */
    val isConnected: Boolean,

    /** The functional role assigned to this printer. */
    val role: PrinterRole
)
