package com.dajaj.pos.bluetooth.escpos

import org.junit.Assert.assertTrue
import org.junit.Test

class TestPrintBuilderTest {

    @Test
    fun `build produces non-empty byte array`() {
        val result = TestPrintBuilder.build()
        assertTrue(result.isNotEmpty())
    }

    @Test
    fun `build contains DAJAJ POS header`() {
        val result = TestPrintBuilder.build()
        val text = String(result, Charsets.UTF_8)
        assertTrue(text.contains("DAJAJ POS"))
    }

    @Test
    fun `build contains test page label`() {
        val result = TestPrintBuilder.build()
        val text = String(result, Charsets.UTF_8)
        assertTrue(text.contains("Printer Test Page"))
    }

    @Test
    fun `build contains alignment test lines`() {
        val result = TestPrintBuilder.build()
        val text = String(result, Charsets.UTF_8)
        assertTrue(text.contains("Left aligned text"))
        assertTrue(text.contains("Center aligned text"))
        assertTrue(text.contains("Right aligned text"))
    }

    @Test
    fun `build contains text style tests`() {
        val result = TestPrintBuilder.build()
        val text = String(result, Charsets.UTF_8)
        assertTrue(text.contains("Bold text sample"))
        assertTrue(text.contains("Double height text"))
    }

    @Test
    fun `build contains success confirmation`() {
        val result = TestPrintBuilder.build()
        val text = String(result, Charsets.UTF_8)
        assertTrue(text.contains("** PRINT TEST OK **"))
        assertTrue(text.contains("Printer is working correctly"))
    }

    @Test
    fun `build starts with init command`() {
        val result = TestPrintBuilder.build()
        assertTrue(result[0] == EscPosCommands.ESC)
        assertTrue(result[1] == 0x40.toByte())
    }

    @Test
    fun `build ends with cut command`() {
        val result = TestPrintBuilder.build()
        val cutCmd = EscPosCommands.CUT
        val lastBytes = result.copyOfRange(result.size - cutCmd.size, result.size)
        assertTrue(lastBytes.contentEquals(cutCmd))
    }
}
