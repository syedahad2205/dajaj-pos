package com.dajaj.pos.bluetooth.escpos

/**
 * Builds ESC/POS print data for Kitchen Order Tickets (KOT).
 *
 * Produces a formatted thermal receipt with:
 * - Centered "DAJAJ - KOT" header
 * - Double-height order number
 * - Order type and timestamp
 * - Item list with quantities and modifiers
 * - Special notes section
 * - Paper cut
 */
object KotTemplateBuilder {

    /**
     * Represents a single item on the KOT.
     *
     * @param name The item display name.
     * @param qty Quantity ordered.
     * @param modifiers List of modifier names (e.g., "Extra Spicy").
     * @param notes Item-specific notes (e.g., "No onion").
     */
    data class KotItem(
        val name: String,
        val qty: Int,
        val modifiers: List<String> = emptyList(),
        val notes: String = ""
    )

    /**
     * Builds the KOT print data as a ByteArray.
     *
     * @param orderNumber The order number (e.g., "1104260001").
     * @param orderType The order type (e.g., "Walk-in", "Takeaway", "Dine-in").
     * @param time The order time string (e.g., "14:30").
     * @param items List of items to print.
     * @param specialNotes General notes for the order.
     * @return ESC/POS formatted byte array ready for printing.
     */
    fun build(
        orderNumber: String,
        orderType: String,
        time: String,
        items: List<KotItem>,
        specialNotes: String = ""
    ): ByteArray {
        return EscPosBuilder()
            .initialize()
            // Header
            .alignCenter()
            .bold(true)
            .text("DAJAJ - KOT")
            .bold(false)
            .lineFeed(1)
            // Order number in double height
            .doubleHeight(true)
            .text("#$orderNumber")
            .doubleHeight(false)
            .lineFeed(1)
            // Order type and time
            .fontSizeNormal()
            .text("Type: $orderType")
            .text("Time: $time")
            .alignLeft()
            .separator()
            // Items
            .apply {
                items.forEach { item ->
                    text("${item.qty}x ${item.name}")
                    if (item.modifiers.isNotEmpty()) {
                        item.modifiers.forEach { modifier ->
                            text("   + $modifier")
                        }
                    }
                    if (item.notes.isNotBlank()) {
                        text("   * ${item.notes}")
                    }
                }
            }
            .separator()
            // Special notes
            .apply {
                if (specialNotes.isNotBlank()) {
                    bold(true)
                    text("NOTES:")
                    bold(false)
                    text(specialNotes)
                    separator()
                }
            }
            // Footer
            .alignCenter()
            .text("--- END OF KOT ---")
            .lineFeed(1)
            .cut()
            .build()
    }
}
