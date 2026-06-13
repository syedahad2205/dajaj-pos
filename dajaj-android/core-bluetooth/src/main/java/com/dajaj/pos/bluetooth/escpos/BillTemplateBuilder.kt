package com.dajaj.pos.bluetooth.escpos

/**
 * Builds ESC/POS print data for Customer Bills.
 *
 * Produces a formatted thermal receipt with:
 * - Centered "DAJAJ RESTAURANT" header
 * - Bill number and order type
 * - Itemized list with prices
 * - Tax breakdown (CGST/SGST)
 * - Bold grand total
 * - Payment method
 * - Footer with thank-you message
 * - Paper cut
 */
object BillTemplateBuilder {

    /**
     * Represents a single item on the bill.
     *
     * @param name The item display name (including variant).
     * @param qty Quantity ordered.
     * @param price Unit price of the item.
     * @param total Line total (qty * price + modifiers).
     */
    data class BillItem(
        val name: String,
        val qty: Int,
        val price: Double,
        val total: Double
    )

    /**
     * Builds the customer bill print data as a ByteArray.
     *
     * @param billNo The bill number (e.g., "DAJAJ-000123").
     * @param orderType The order type (e.g., "Walk-in", "Takeaway", "Dine-in").
     * @param items List of bill items.
     * @param subtotal Subtotal before taxes.
     * @param cgst CGST amount.
     * @param sgst SGST amount.
     * @param grandTotal Grand total (subtotal + cgst + sgst).
     * @param paymentMethod Payment method (e.g., "Cash", "UPI", "Card").
     * @return ESC/POS formatted byte array ready for printing.
     */
    fun build(
        billNo: String,
        orderType: String,
        items: List<BillItem>,
        subtotal: Double,
        cgst: Double,
        sgst: Double,
        grandTotal: Double,
        paymentMethod: String
    ): ByteArray {
        return EscPosBuilder()
            .initialize()
            // Restaurant header
            .alignCenter()
            .bold(true)
            .doubleHeight(true)
            .text("DAJAJ RESTAURANT")
            .doubleHeight(false)
            .bold(false)
            .lineFeed(1)
            // Bill info
            .text("Bill: $billNo")
            .text("Type: $orderType")
            .alignLeft()
            .separator()
            // Itemized list
            .apply {
                items.forEach { item ->
                    val itemLine = "${item.qty}x ${item.name}"
                    val priceStr = formatCurrency(item.total)
                    twoColumnLine(itemLine, priceStr)
                }
            }
            .separator()
            // Tax breakdown
            .twoColumnLine("Subtotal:", formatCurrency(subtotal))
            .twoColumnLine("CGST:", formatCurrency(cgst))
            .twoColumnLine("SGST:", formatCurrency(sgst))
            .separator()
            // Grand total (bold)
            .bold(true)
            .twoColumnLine("TOTAL:", formatCurrency(grandTotal))
            .bold(false)
            .separator()
            // Payment method
            .twoColumnLine("Paid via:", paymentMethod)
            .lineFeed(1)
            // Footer
            .alignCenter()
            .text("Thank you for dining with us!")
            .text("Visit again soon")
            .lineFeed(1)
            .cut()
            .build()
    }

    /**
     * Formats a double amount as Indian Rupee currency string.
     */
    private fun formatCurrency(amount: Double): String {
        return "Rs.%.2f".format(amount)
    }
}
