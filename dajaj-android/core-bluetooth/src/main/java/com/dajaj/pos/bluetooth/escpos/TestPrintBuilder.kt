package com.dajaj.pos.bluetooth.escpos

/**
 * Generates a test print page for verifying printer connectivity and formatting.
 *
 * The test page includes:
 * - Logo text header
 * - Alignment demonstration (left, center, right)
 * - Bold and double-height text samples
 * - Separator line
 * - Success confirmation message
 * - Paper cut
 */
object TestPrintBuilder {

    /**
     * Builds the test print page as a ByteArray.
     *
     * @return ESC/POS formatted byte array for the test page.
     */
    fun build(): ByteArray {
        return EscPosBuilder()
            .initialize()
            // Logo / Header
            .alignCenter()
            .bold(true)
            .doubleHeight(true)
            .text("DAJAJ POS")
            .doubleHeight(false)
            .bold(false)
            .text("Printer Test Page")
            .lineFeed(1)
            .separator()
            // Alignment tests
            .alignLeft()
            .text("Left aligned text")
            .alignCenter()
            .text("Center aligned text")
            .alignRight()
            .text("Right aligned text")
            .alignLeft()
            .lineFeed(1)
            .separator()
            // Text style tests
            .bold(true)
            .text("Bold text sample")
            .bold(false)
            .doubleHeight(true)
            .text("Double height text")
            .doubleHeight(false)
            .fontSizeNormal()
            .lineFeed(1)
            .separator()
            // Two-column test
            .twoColumnLine("Item Name", "Rs.100.00")
            .twoColumnLine("Another Item", "Rs.250.50")
            .separator()
            // Success confirmation
            .lineFeed(1)
            .alignCenter()
            .bold(true)
            .text("** PRINT TEST OK **")
            .bold(false)
            .text("Printer is working correctly")
            .lineFeed(1)
            .cut()
            .build()
    }
}
