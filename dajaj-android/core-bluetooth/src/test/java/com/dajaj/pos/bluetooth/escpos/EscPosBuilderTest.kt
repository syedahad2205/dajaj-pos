package com.dajaj.pos.bluetooth.escpos

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class EscPosBuilderTest {

    @Test
    fun `initialize adds ESC @ command`() {
        val result = EscPosBuilder().initialize().build()
        assertArrayEquals(EscPosCommands.INIT, result)
    }

    @Test
    fun `alignCenter adds correct alignment bytes`() {
        val result = EscPosBuilder().alignCenter().build()
        assertArrayEquals(EscPosCommands.ALIGN_CENTER, result)
    }

    @Test
    fun `alignLeft adds correct alignment bytes`() {
        val result = EscPosBuilder().alignLeft().build()
        assertArrayEquals(EscPosCommands.ALIGN_LEFT, result)
    }

    @Test
    fun `alignRight adds correct alignment bytes`() {
        val result = EscPosBuilder().alignRight().build()
        assertArrayEquals(EscPosCommands.ALIGN_RIGHT, result)
    }

    @Test
    fun `bold on adds bold enable bytes`() {
        val result = EscPosBuilder().bold(true).build()
        assertArrayEquals(EscPosCommands.BOLD_ON, result)
    }

    @Test
    fun `bold off adds bold disable bytes`() {
        val result = EscPosBuilder().bold(false).build()
        assertArrayEquals(EscPosCommands.BOLD_OFF, result)
    }

    @Test
    fun `doubleHeight on adds correct bytes`() {
        val result = EscPosBuilder().doubleHeight(true).build()
        assertArrayEquals(EscPosCommands.DOUBLE_HEIGHT_ON, result)
    }

    @Test
    fun `doubleHeight off adds correct bytes`() {
        val result = EscPosBuilder().doubleHeight(false).build()
        assertArrayEquals(EscPosCommands.DOUBLE_HEIGHT_OFF, result)
    }

    @Test
    fun `text appends text with line feed`() {
        val result = EscPosBuilder().text("Hello").build()
        val expected = "Hello".toByteArray(Charsets.UTF_8) + byteArrayOf(EscPosCommands.LF)
        assertArrayEquals(expected, result)
    }

    @Test
    fun `lineFeed adds correct number of LF characters`() {
        val result = EscPosBuilder().lineFeed(3).build()
        val expected = byteArrayOf(EscPosCommands.LF, EscPosCommands.LF, EscPosCommands.LF)
        assertArrayEquals(expected, result)
    }

    @Test
    fun `separator creates full-width dashed line`() {
        val result = EscPosBuilder().separator().build()
        val expectedText = "-".repeat(EscPosBuilder.LINE_WIDTH)
        val expected = expectedText.toByteArray(Charsets.UTF_8) + byteArrayOf(EscPosCommands.LF)
        assertArrayEquals(expected, result)
    }

    @Test
    fun `cut adds line feeds then cut command`() {
        val result = EscPosBuilder().cut().build()
        val expected = byteArrayOf(
            EscPosCommands.LF, EscPosCommands.LF, EscPosCommands.LF
        ) + EscPosCommands.CUT
        assertArrayEquals(expected, result)
    }

    @Test
    fun `twoColumnLine formats left and right aligned text`() {
        val result = EscPosBuilder().twoColumnLine("Item", "Rs.100.00").build()
        val resultStr = String(result.copyOfRange(0, result.size - 1), Charsets.UTF_8)
        assertEquals(EscPosBuilder.LINE_WIDTH, resultStr.length)
        assertTrue(resultStr.startsWith("Item"))
        assertTrue(resultStr.endsWith("Rs.100.00"))
    }

    @Test
    fun `twoColumnLine truncates long left text`() {
        val longName = "A".repeat(40)
        val result = EscPosBuilder().twoColumnLine(longName, "Rs.10").build()
        val resultStr = String(result.copyOfRange(0, result.size - 1), Charsets.UTF_8)
        assertEquals(EscPosBuilder.LINE_WIDTH, resultStr.length)
        assertTrue(resultStr.endsWith("Rs.10"))
    }

    @Test
    fun `fluent builder chains multiple commands correctly`() {
        val result = EscPosBuilder()
            .initialize()
            .alignCenter()
            .bold(true)
            .text("Hello")
            .bold(false)
            .build()

        // Verify it starts with INIT
        assertTrue(result.size > EscPosCommands.INIT.size)
        assertEquals(EscPosCommands.INIT[0], result[0])
        assertEquals(EscPosCommands.INIT[1], result[1])
    }

    @Test
    fun `build returns empty array when nothing added`() {
        val result = EscPosBuilder().build()
        assertEquals(0, result.size)
    }

    @Test
    fun `fontSizeNormal adds correct bytes`() {
        val result = EscPosBuilder().fontSizeNormal().build()
        assertArrayEquals(EscPosCommands.FONT_SIZE_NORMAL, result)
    }

    @Test
    fun `fontSizeLarge adds correct bytes`() {
        val result = EscPosBuilder().fontSizeLarge().build()
        assertArrayEquals(EscPosCommands.FONT_SIZE_LARGE, result)
    }
}
