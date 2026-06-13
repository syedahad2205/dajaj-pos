package com.dajaj.pos.domain.model

/**
 * Identifies the type of print job in the print queue system.
 *
 * All print actions flow through Firestore as print job documents;
 * printing never occurs directly from the UI.
 */
enum class PrintJobType {
    /** Kitchen Order Ticket — sent to the kitchen printer. */
    KOT,

    /** Customer bill — itemized receipt with taxes and total. */
    CUSTOMER_BILL,

    /** Reprint of a previous KOT or bill, marked with a REPRINT header. */
    REPRINT;

    companion object {
        fun fromString(value: String): PrintJobType = when (value.lowercase()) {
            "kot" -> KOT
            "customer_bill" -> CUSTOMER_BILL
            "reprint" -> REPRINT
            else -> KOT
        }
    }

    fun toFirestoreValue(): String = when (this) {
        KOT -> "kot"
        CUSTOMER_BILL -> "customer_bill"
        REPRINT -> "reprint"
    }
}
