package com.dajaj.pos.domain.model

/**
 * Structured print payload containing formatted content for thermal printing.
 *
 * Used within [PrintJob] to describe what should be printed.
 * The ESC/POS builder transforms this into binary printer commands.
 */
data class PrintPayload(
    /** Header text (e.g., "KITCHEN ORDER", "CUSTOMER BILL"). */
    val header: String,

    /** Human-readable order number. */
    val orderNumber: String,

    /** Order type label (e.g., "Takeaway", "Dine In"). */
    val orderType: String,

    /** Formatted timestamp string (e.g., "2024-01-15 14:30"). */
    val timestamp: String,

    /** Items to print on the receipt/KOT. */
    val items: List<PrintPayloadItem>,

    /** Special notes for the entire order, null if none. */
    val specialNotes: String?
)

/**
 * Represents a single item line in a print payload.
 */
data class PrintPayloadItem(
    /** Quantity of this item. */
    val qty: Int,

    /** Display name of the item. */
    val name: String,

    /** List of modifier names applied to this item. */
    val modifiers: List<String>,

    /** Item-specific notes, null if none. */
    val notes: String?
)
