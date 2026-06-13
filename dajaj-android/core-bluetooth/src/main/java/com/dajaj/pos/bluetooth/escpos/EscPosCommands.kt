package com.dajaj.pos.bluetooth.escpos

/**
 * ESC/POS command constants for thermal printer communication.
 *
 * Standard ESC/POS byte sequences used to control text formatting,
 * alignment, paper feeding, and cutting on thermal receipt printers.
 */
object EscPosCommands {

    // --- Control Characters ---
    const val ESC: Byte = 0x1B
    const val GS: Byte = 0x1D
    const val LF: Byte = 0x0A
    const val CR: Byte = 0x0D

    // --- Printer Initialization ---
    /** ESC @ — Initialize printer (reset to default settings). */
    val INIT: ByteArray = byteArrayOf(ESC, 0x40)

    // --- Text Emphasis ---
    /** ESC E 1 — Enable bold text. */
    val BOLD_ON: ByteArray = byteArrayOf(ESC, 0x45, 0x01)

    /** ESC E 0 — Disable bold text. */
    val BOLD_OFF: ByteArray = byteArrayOf(ESC, 0x45, 0x00)

    // --- Text Size ---
    /** GS ! 0x00 — Normal size (1x width, 1x height). */
    val FONT_SIZE_NORMAL: ByteArray = byteArrayOf(GS, 0x21, 0x00)

    /** GS ! 0x11 — Large size (2x width, 2x height). */
    val FONT_SIZE_LARGE: ByteArray = byteArrayOf(GS, 0x21, 0x11)

    /** ESC ! 0x10 — Enable double-height text. */
    val DOUBLE_HEIGHT_ON: ByteArray = byteArrayOf(ESC, 0x21, 0x10)

    /** ESC ! 0x00 — Disable double-height text (normal). */
    val DOUBLE_HEIGHT_OFF: ByteArray = byteArrayOf(ESC, 0x21, 0x00)

    // --- Text Alignment ---
    /** ESC a 0 — Align text left. */
    val ALIGN_LEFT: ByteArray = byteArrayOf(ESC, 0x61, 0x00)

    /** ESC a 1 — Align text center. */
    val ALIGN_CENTER: ByteArray = byteArrayOf(ESC, 0x61, 0x01)

    /** ESC a 2 — Align text right. */
    val ALIGN_RIGHT: ByteArray = byteArrayOf(ESC, 0x61, 0x02)

    // --- Paper Control ---
    /** GS V 0 — Full cut paper. */
    val CUT: ByteArray = byteArrayOf(GS, 0x56, 0x00)

    /** GS V 1 — Partial cut paper. */
    val PARTIAL_CUT: ByteArray = byteArrayOf(GS, 0x56, 0x01)
}
