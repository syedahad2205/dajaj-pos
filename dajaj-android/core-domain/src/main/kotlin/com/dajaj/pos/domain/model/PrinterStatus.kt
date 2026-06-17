package com.dajaj.pos.domain.model

/**
 * Represents the current connection status of a Bluetooth printer.
 */
enum class PrinterStatus {
    /** Printer is connected and ready to receive print data. */
    CONNECTED,

    /** Printer is not connected. */
    DISCONNECTED,

    /** Printer connection was lost; auto-reconnect is in progress. */
    RECONNECTING;

    companion object {
        fun fromString(value: String): PrinterStatus = when (value.lowercase()) {
            "connected" -> CONNECTED
            "disconnected" -> DISCONNECTED
            "reconnecting" -> RECONNECTING
            else -> DISCONNECTED
        }
    }

    fun toFirestoreValue(): String = when (this) {
        CONNECTED -> "connected"
        DISCONNECTED -> "disconnected"
        RECONNECTING -> "reconnecting"
    }
}
