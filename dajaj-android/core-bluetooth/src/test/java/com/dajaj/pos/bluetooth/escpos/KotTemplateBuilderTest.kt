package com.dajaj.pos.bluetooth.escpos

import org.junit.Assert.assertTrue
import org.junit.Test

class KotTemplateBuilderTest {

    @Test
    fun `build produces non-empty byte array`() {
        val result = KotTemplateBuilder.build(
            orderNumber = "1104260001",
            orderType = "Walk-in",
            time = "14:30",
            items = listOf(
                KotTemplateBuilder.KotItem("Regular Alfaham Qtr", 2)
            )
        )
        assertTrue(result.isNotEmpty())
    }

    @Test
    fun `build contains DAJAJ KOT header`() {
        val result = KotTemplateBuilder.build(
            orderNumber = "1104260001",
            orderType = "Takeaway",
            time = "14:30",
            items = listOf(
                KotTemplateBuilder.KotItem("Shawarma Roll", 1)
            )
        )
        val text = String(result, Charsets.UTF_8)
        assertTrue(text.contains("DAJAJ - KOT"))
    }

    @Test
    fun `build contains order number`() {
        val result = KotTemplateBuilder.build(
            orderNumber = "1104260042",
            orderType = "Dine-in",
            time = "18:00",
            items = listOf(
                KotTemplateBuilder.KotItem("Tandoor Chicken", 1)
            )
        )
        val text = String(result, Charsets.UTF_8)
        assertTrue(text.contains("#1104260042"))
    }

    @Test
    fun `build contains order type`() {
        val result = KotTemplateBuilder.build(
            orderNumber = "1001",
            orderType = "Takeaway",
            time = "12:00",
            items = listOf(
                KotTemplateBuilder.KotItem("Item", 1)
            )
        )
        val text = String(result, Charsets.UTF_8)
        assertTrue(text.contains("Type: Takeaway"))
    }

    @Test
    fun `build contains time`() {
        val result = KotTemplateBuilder.build(
            orderNumber = "1001",
            orderType = "Walk-in",
            time = "09:15",
            items = listOf(
                KotTemplateBuilder.KotItem("Item", 1)
            )
        )
        val text = String(result, Charsets.UTF_8)
        assertTrue(text.contains("Time: 09:15"))
    }

    @Test
    fun `build contains items with quantities`() {
        val result = KotTemplateBuilder.build(
            orderNumber = "1001",
            orderType = "Walk-in",
            time = "14:30",
            items = listOf(
                KotTemplateBuilder.KotItem("Regular Alfaham", 2),
                KotTemplateBuilder.KotItem("Peri Peri Shawarma", 3)
            )
        )
        val text = String(result, Charsets.UTF_8)
        assertTrue(text.contains("2x Regular Alfaham"))
        assertTrue(text.contains("3x Peri Peri Shawarma"))
    }

    @Test
    fun `build contains modifiers when present`() {
        val result = KotTemplateBuilder.build(
            orderNumber = "1001",
            orderType = "Walk-in",
            time = "14:30",
            items = listOf(
                KotTemplateBuilder.KotItem(
                    name = "Alfaham Qtr",
                    qty = 1,
                    modifiers = listOf("Extra Spicy", "No Mayo")
                )
            )
        )
        val text = String(result, Charsets.UTF_8)
        assertTrue(text.contains("+ Extra Spicy"))
        assertTrue(text.contains("+ No Mayo"))
    }

    @Test
    fun `build contains item notes when present`() {
        val result = KotTemplateBuilder.build(
            orderNumber = "1001",
            orderType = "Walk-in",
            time = "14:30",
            items = listOf(
                KotTemplateBuilder.KotItem(
                    name = "Alfaham",
                    qty = 1,
                    notes = "Well done"
                )
            )
        )
        val text = String(result, Charsets.UTF_8)
        assertTrue(text.contains("* Well done"))
    }

    @Test
    fun `build contains special notes when provided`() {
        val result = KotTemplateBuilder.build(
            orderNumber = "1001",
            orderType = "Walk-in",
            time = "14:30",
            items = listOf(
                KotTemplateBuilder.KotItem("Item", 1)
            ),
            specialNotes = "Rush order - VIP customer"
        )
        val text = String(result, Charsets.UTF_8)
        assertTrue(text.contains("NOTES:"))
        assertTrue(text.contains("Rush order - VIP customer"))
    }

    @Test
    fun `build omits notes section when no special notes`() {
        val result = KotTemplateBuilder.build(
            orderNumber = "1001",
            orderType = "Walk-in",
            time = "14:30",
            items = listOf(
                KotTemplateBuilder.KotItem("Item", 1)
            ),
            specialNotes = ""
        )
        val text = String(result, Charsets.UTF_8)
        assertTrue(!text.contains("NOTES:"))
    }

    @Test
    fun `build starts with printer init command`() {
        val result = KotTemplateBuilder.build(
            orderNumber = "1001",
            orderType = "Walk-in",
            time = "14:30",
            items = listOf(
                KotTemplateBuilder.KotItem("Item", 1)
            )
        )
        // ESC @
        assertTrue(result[0] == EscPosCommands.ESC)
        assertTrue(result[1] == 0x40.toByte())
    }

    @Test
    fun `build ends with cut command`() {
        val result = KotTemplateBuilder.build(
            orderNumber = "1001",
            orderType = "Walk-in",
            time = "14:30",
            items = listOf(
                KotTemplateBuilder.KotItem("Item", 1)
            )
        )
        // Last 3 bytes should be GS V 0 (cut command)
        val cutCmd = EscPosCommands.CUT
        val lastBytes = result.copyOfRange(result.size - cutCmd.size, result.size)
        assertTrue(lastBytes.contentEquals(cutCmd))
    }
}
