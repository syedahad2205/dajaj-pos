package com.dajaj.pos.printagent

/**
 * Represents the operational state of the Print Agent foreground service.
 *
 * Displayed in the persistent notification to inform the user of current activity.
 */
enum class PrintAgentState {
    /** Service is running and listening for print jobs, but not currently printing. */
    IDLE,

    /** Service is actively sending data to the Bluetooth printer. */
    PRINTING,

    /** A print error has occurred (e.g., printer disconnected, job failed). */
    ERROR
}
