package com.dajaj.pos.bluetooth.escpos

/**
 * Supported thermal printer paper widths.
 *
 * @param charsPerLine Maximum printable characters per line for the given paper width.
 */
enum class PaperWidth(val charsPerLine: Int) {
    /** 58mm paper — 32 characters per line. */
    MM_58(32),

    /** 80mm paper — 48 characters per line (default for new printers). */
    MM_80(48);

    companion object {
        /** Default paper width for newly paired printers. */
        val DEFAULT = MM_80
    }
}
