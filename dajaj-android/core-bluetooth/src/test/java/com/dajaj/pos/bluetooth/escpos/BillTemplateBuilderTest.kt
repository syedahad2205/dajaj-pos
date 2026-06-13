package com.dajaj.pos.bluetooth.escpos

import org.junit.Assert.assertTrue
import org.junit.Test

class BillTemplateBuilderTest {

    @Test
    fun `build produces non-empty byte array`() {
        val result = buildSampleBill()
        assertTrue(result.isNotEmpty())
    }

    @Test
    fun `build contains restaurant header`() {
        val result = buildSampleBill()
        val text = String(result, Charsets.UTF_8)
        assertTrue(text.contains("DAJAJ RESTAURANT"))
    }

    @Test
    fun `build contains bill number`() {
        val result = BillTemplateBuilder.build(
            billNo = "DAJAJ-000456",
            orderType = "Walk-in",
            items = listOf(
                BillTemplateBuilder.BillItem("Alfaham", 1, 120.0, 120.0)
            ),
            subtotal = 120.0,
            cgst = 6.0,
            sgst = 6.0,
            grandTotal = 132.0,
            paymentMethod = "Cash"
        )
        val text = String(result, Charsets.UTF_8)
        assertTrue(text.contains("DAJAJ-000456"))
    }

    @Test
    fun `build contains order type`() {
        val result = BillTemplateBuilder.build(
            billNo = "DAJAJ-001",
            orderType = "Takeaway",
            items = listOf(
                BillTemplateBuilder.BillItem("Item", 1, 100.0, 100.0)
            ),
            subtotal = 100.0,
            cgst = 5.0,
            sgst = 5.0,
            grandTotal = 110.0,
            paymentMethod = "UPI"
        )
        val text = String(result, Charsets.UTF_8)
        assertTrue(text.contains("Type: Takeaway"))
    }

    @Test
    fun `build contains item names and quantities`() {
        val result = BillTemplateBuilder.build(
            billNo = "DAJAJ-001",
            orderType = "Walk-in",
            items = listOf(
                BillTemplateBuilder.BillItem("Regular Alfaham Qtr", 2, 120.0, 240.0),
                BillTemplateBuilder.BillItem("Peri Peri Roll", 1, 60.0, 60.0)
            ),
            subtotal = 300.0,
            cgst = 15.0,
            sgst = 15.0,
            grandTotal = 330.0,
            paymentMethod = "Cash"
        )
        val text = String(result, Charsets.UTF_8)
        assertTrue(text.contains("2x Regular Alfaham Qtr"))
        assertTrue(text.contains("1x Peri Peri Roll"))
    }

    @Test
    fun `build contains tax breakdown`() {
        val result = BillTemplateBuilder.build(
            billNo = "DAJAJ-001",
            orderType = "Walk-in",
            items = listOf(
                BillTemplateBuilder.BillItem("Item", 1, 200.0, 200.0)
            ),
            subtotal = 200.0,
            cgst = 10.0,
            sgst = 10.0,
            grandTotal = 220.0,
            paymentMethod = "Cash"
        )
        val text = String(result, Charsets.UTF_8)
        assertTrue(text.contains("Subtotal:"))
        assertTrue(text.contains("CGST:"))
        assertTrue(text.contains("SGST:"))
        assertTrue(text.contains("TOTAL:"))
    }

    @Test
    fun `build contains payment method`() {
        val result = BillTemplateBuilder.build(
            billNo = "DAJAJ-001",
            orderType = "Walk-in",
            items = listOf(
                BillTemplateBuilder.BillItem("Item", 1, 100.0, 100.0)
            ),
            subtotal = 100.0,
            cgst = 5.0,
            sgst = 5.0,
            grandTotal = 110.0,
            paymentMethod = "UPI"
        )
        val text = String(result, Charsets.UTF_8)
        assertTrue(text.contains("UPI"))
    }

    @Test
    fun `build contains thank-you footer`() {
        val result = buildSampleBill()
        val text = String(result, Charsets.UTF_8)
        assertTrue(text.contains("Thank you for dining with us!"))
    }

    @Test
    fun `build starts with printer init command`() {
        val result = buildSampleBill()
        assertTrue(result[0] == EscPosCommands.ESC)
        assertTrue(result[1] == 0x40.toByte())
    }

    @Test
    fun `build ends with cut command`() {
        val result = buildSampleBill()
        val cutCmd = EscPosCommands.CUT
        val lastBytes = result.copyOfRange(result.size - cutCmd.size, result.size)
        assertTrue(lastBytes.contentEquals(cutCmd))
    }

    private fun buildSampleBill(): ByteArray {
        return BillTemplateBuilder.build(
            billNo = "DAJAJ-000123",
            orderType = "Walk-in",
            items = listOf(
                BillTemplateBuilder.BillItem("Regular Alfaham Qtr", 2, 120.0, 240.0),
                BillTemplateBuilder.BillItem("Peri Peri Shawarma", 1, 60.0, 60.0)
            ),
            subtotal = 300.0,
            cgst = 15.0,
            sgst = 15.0,
            grandTotal = 330.0,
            paymentMethod = "Cash"
        )
    }
}
