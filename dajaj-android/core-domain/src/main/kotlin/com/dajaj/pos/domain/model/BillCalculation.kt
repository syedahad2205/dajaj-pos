package com.dajaj.pos.domain.model

/**
 * Value object representing the financial breakdown of a bill.
 *
 * Tax calculation formula:
 * ```
 * taxableAmount = subtotal - discountAmount + serviceChargeAmount
 * cgst = taxableAmount * taxRate
 * sgst = taxableAmount * taxRate
 * grandTotal = taxableAmount + cgst + sgst
 * ```
 *
 * All monetary values are rounded to 2 decimal places.
 */
data class BillCalculation(
    /** Sum of all item line totals. */
    val subtotal: Double,

    /** Total discount amount applied. */
    val discountAmount: Double,

    /** Service charge amount (subtotal * serviceChargePercent). */
    val serviceChargeAmount: Double,

    /** Central GST amount. */
    val cgst: Double,

    /** State GST amount. */
    val sgst: Double,

    /** Final total: taxableAmount + cgst + sgst. */
    val grandTotal: Double
)
