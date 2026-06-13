package com.dajaj.pos.bluetooth.model

/**
 * Represents the current connection state of the Bluetooth printer subsystem.
 */
enum class PrinterConnectionState {
    /** A printer is actively connected and ready. */
    CONNECTED,

    /** No printer is connected. */
    DISCONNECTED,

    /** The system is attempting to reconnect to a previously paired printer. */
    RECONNECTING,

    /** A Bluetooth scan is in progress. */
    SCANNING
}
