package com.dajaj.pos.bluetooth.model

/**
 * Defines the functional role assigned to a paired printer.
 */
enum class PrinterRole {
    /** Kitchen Order Ticket printer. */
    KOT,

    /** Customer bill printer. */
    BILL,

    /** No role assigned yet. */
    NONE
}
