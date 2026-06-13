package com.dajaj.pos.bluetooth.escpos

import java.io.ByteArrayOutputStream
import java.nio.charset.Charset

/**
 * Builder for constructing ESC/POS command byte arrays for thermal printers.
 *
 * Provides a fluent API for composing formatted print data including
 * text alignment, emphasis, sizing, line feeds, separators, and paper cutting.
 *
 * Usage:
 * ```
 * val data = EscPosBuilder()
 *     .initialize()
 *     .alignCenter()
 *     .bold(true)
 *     .text("DAJAJ RESTAURANT")
 *     .bold(false)
 *     .alignLeft()
 *     .separator()
 *     .text("1x Regular Alfaham")
 *     .cut()
 *     .build()
 * ```
 */
class EscPosBuilder {

    private val buffer = ByteArrayOutputStream()

    companion object {
        /** Default charset for text encoding (most thermal printers use CP437 or UTF-8). */
        private val CHARSET: Charset = Charsets.UTF_8

        /** Width of the printable area in characters (standard 58mm paper). */
        const val LINE_WIDTH = 32

        /** Separator character used for dashed lines. */
        private const val SEPARATOR_CHAR = '-'
    }

    /**
     * Sends the printer initialization command (ESC @).
     * Resets the printer to default settings. Should be called first.
     */
    fun initialize(): EscPosBuilder {
        buffer.write(EscPosCommands.INIT)
        return this
    }

    /**
     * Sets text alignment to left.
     */
    fun alignLeft(): EscPosBuilder {
        buffer.write(EscPosCommands.ALIGN_LEFT)
        return this
    }

    /**
     * Sets text alignment to center.
     */
    fun alignCenter(): EscPosBuilder {
        buffer.write(EscPosCommands.ALIGN_CENTER)
        return this
    }

    /**
     * Sets text alignment to right.
     */
    fun alignRight(): EscPosBuilder {
        buffer.write(EscPosCommands.ALIGN_RIGHT)
        return this
    }

    /**
     * Toggles bold text on or off.
     *
     * @param on true to enable bold, false to disable.
     */
    fun bold(on: Boolean): EscPosBuilder {
        buffer.write(if (on) EscPosCommands.BOLD_ON else EscPosCommands.BOLD_OFF)
        return this
    }

    /**
     * Toggles double-height text on or off.
     *
     * @param on true to enable double height, false to disable.
     */
    fun doubleHeight(on: Boolean): EscPosBuilder {
        buffer.write(if (on) EscPosCommands.DOUBLE_HEIGHT_ON else EscPosCommands.DOUBLE_HEIGHT_OFF)
        return this
    }

    /**
     * Sets font size to normal (1x width, 1x height).
     */
    fun fontSizeNormal(): EscPosBuilder {
        buffer.write(EscPosCommands.FONT_SIZE_NORMAL)
        return this
    }

    /**
     * Sets font size to large (2x width, 2x height).
     */
    fun fontSizeLarge(): EscPosBuilder {
        buffer.write(EscPosCommands.FONT_SIZE_LARGE)
        return this
    }

    /**
     * Adds a line of text followed by a line feed.
     *
     * @param line The text to print.
     */
    fun text(line: String): EscPosBuilder {
        buffer.write(line.toByteArray(CHARSET))
        buffer.write(byteArrayOf(EscPosCommands.LF))
        return this
    }

    /**
     * Adds raw text without a trailing line feed.
     *
     * @param content The text to append.
     */
    fun rawText(content: String): EscPosBuilder {
        buffer.write(content.toByteArray(CHARSET))
        return this
    }

    /**
     * Adds the specified number of line feed characters.
     *
     * @param count Number of line feeds to add (default 1).
     */
    fun lineFeed(count: Int = 1): EscPosBuilder {
        repeat(count) {
            buffer.write(byteArrayOf(EscPosCommands.LF))
        }
        return this
    }

    /**
     * Prints a dashed separator line spanning the full print width.
     */
    fun separator(): EscPosBuilder {
        val line = SEPARATOR_CHAR.toString().repeat(LINE_WIDTH)
        return text(line)
    }

    /**
     * Sends the paper cut command (full cut).
     */
    fun cut(): EscPosBuilder {
        lineFeed(3)
        buffer.write(EscPosCommands.CUT)
        return this
    }

    /**
     * Formats a left-right justified line within the print width.
     * Useful for item/price pairs or label/value rows.
     *
     * @param left The left-aligned text.
     * @param right The right-aligned text.
     */
    fun twoColumnLine(left: String, right: String): EscPosBuilder {
        val availableSpace = LINE_WIDTH - right.length
        val paddedLeft = if (left.length > availableSpace) {
            left.substring(0, availableSpace)
        } else {
            left.padEnd(availableSpace)
        }
        return text("$paddedLeft$right")
    }

    /**
     * Builds and returns the accumulated ESC/POS byte array.
     *
     * @return The complete byte array ready to send to the printer.
     */
    fun build(): ByteArray {
        return buffer.toByteArray()
    }
}
