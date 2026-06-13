package com.dajaj.pos.bluetooth.escpos

import org.junit.Assert.assertTrue
import org.junit.Test

class ReprintTemplateBuilderTest {

    @Test
    fun `build prepends REPRINT header to original payload`() {
        val original = KotTemplateBuilder.build(
            orderNumber = "1001",
            orderType = "Walk-in",
            time = "14:30",
            items = listOf(
                KotTemplateBuilder.KotItem("Alfaham", 1)
            )
        )

        val reprint = ReprintTemplateBuilder.build(original)
        val text = String(reprint, Charsets.UTF_8)
        assertTrue(text.contains("*** REPRINT ***"))
    }

    @Test
    fun `build contains original content after header`() {
        val original = KotTemplateBuilder.build(
            orderNumber = "1104260099",
            orderType = "Takeaway",
            time = "18:30",
            items = listOf(
                KotTemplateBuilder.KotItem("Shawarma Roll", 2)
            )
        )

        val reprint = ReprintTemplateBuilder.build(original)
        val text = String(reprint, Charsets.UTF_8)
        assertTrue(text.contains("*** REPRINT ***"))
        assertTrue(text.contains("DAJAJ - KOT"))
        assertTrue(text.contains("#1104260099"))
        assertTrue(text.contains("2x Shawarma Roll"))
    }

    @Test
    fun `build starts with init command`() {
        val original = BillTemplateBuilder.build(
            billNo = "DAJAJ-001",
            orderType = "Walk-in",
            items = listOf(
                BillTemplateBuilder.BillItem("Item", 1, 100.0, 100.0)
            ),
            subtotal = 100.0,
            cgst = 5.0,
            sgst = 5.0,
            grandTotal = 110.0,
            paymentMethod = "Cash"
        )

        val reprint = ReprintTemplateBuilder.build(original)
        assertTrue(reprint[0] == EscPosCommands.ESC)
        assertTrue(reprint[1] == 0x40.toByte())
    }

    @Test
    fun `build does not double-init when original starts with ESC @`() {
        val original = EscPosBuilder()
            .initialize()
            .text("Hello")
            .build()

        val reprint = ReprintTemplateBuilder.build(original)
        // Count occurrences of ESC @ (0x1B 0x40)
        var initCount = 0
        for (i in 0 until reprint.size - 1) {
            if (reprint[i] == EscPosCommands.ESC && reprint[i + 1] == 0x40.toByte()) {
                initCount++
            }
        }
        // Should only have one init (from the REPRINT header)
        assertTrue("Expected exactly 1 INIT command, found $initCount", initCount == 1)
    }

    @Test
    fun `build works with bill template`() {
        val original = BillTemplateBuilder.build(
            billNo = "DAJAJ-000555",
            orderType = "Dine-in",
            items = listOf(
                BillTemplateBuilder.BillItem("Tandoor", 3, 200.0, 600.0)
            ),
            subtotal = 600.0,
            cgst = 30.0,
            sgst = 30.0,
            grandTotal = 660.0,
            paymentMethod = "Card"
        )

        val reprint = ReprintTemplateBuilder.build(original)
        val text = String(reprint, Charsets.UTF_8)
        assertTrue(text.contains("*** REPRINT ***"))
        assertTrue(text.contains("DAJAJ RESTAURANT"))
        assertTrue(text.contains("DAJAJ-000555"))
    }

    @Test
    fun `reprint is larger than original`() {
        val original = KotTemplateBuilder.build(
            orderNumber = "1001",
            orderType = "Walk-in",
            time = "14:30",
            items = listOf(
                KotTemplateBuilder.KotItem("Item", 1)
            )
        )

        val reprint = ReprintTemplateBuilder.build(original)
        assertTrue(reprint.size > original.size)
    }
}
