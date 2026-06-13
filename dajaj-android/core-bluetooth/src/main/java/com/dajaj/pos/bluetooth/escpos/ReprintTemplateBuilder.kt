package com.dajaj.pos.bluetooth.escpos

/**
 * Wraps an original print template with a "REPRINT" header.
 *
 * Used when reprinting a previously completed print job (KOT or Bill).
 * Adds a clearly visible "*** REPRINT ***" header before the original content
 * to distinguish reprints from originals.
 */
object ReprintTemplateBuilder {

    /**
     * Builds a reprint by prepending a REPRINT header to the original template payload.
     *
     * @param originalPayload The original ESC/POS byte array (from KOT or Bill template).
     * @return A new byte array with REPRINT header + original content.
     */
    fun build(originalPayload: ByteArray): ByteArray {
        val header = EscPosBuilder()
            .initialize()
            .alignCenter()
            .bold(true)
            .doubleHeight(true)
            .text("*** REPRINT ***")
            .doubleHeight(false)
            .bold(false)
            .lineFeed(1)
            .build()

        // Combine header with original payload (skip the INIT command from original
        // since we already initialized in the header)
        val originalWithoutInit = if (originalPayload.size >= 2 &&
            originalPayload[0] == EscPosCommands.ESC &&
            originalPayload[1] == 0x40.toByte()
        ) {
            originalPayload.copyOfRange(2, originalPayload.size)
        } else {
            originalPayload
        }

        return header + originalWithoutInit
    }
}
