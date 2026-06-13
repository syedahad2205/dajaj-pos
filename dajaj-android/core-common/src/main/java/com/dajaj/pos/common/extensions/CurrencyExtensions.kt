package com.dajaj.pos.common.extensions

import java.text.NumberFormat
import java.util.Locale

/**
 * Standard GST rates for Indian restaurant billing.
 * Total GST = CGST + SGST = 5%.
 */
private const val CGST_RATE = 0.025 // 2.5%
private const val SGST_RATE = 0.025 // 2.5%

/**
 * Formats a [Number] as Indian Rupees.
 * Examples: 120 → "₹120.00", 1500.5 → "₹1,500.50"
 */
fun Number.toRupees(): String {
    val formatter = NumberFormat.getCurrencyInstance(Locale("en", "IN"))
    return formatter.format(this)
}

/**
 * Formats a [Number] as Indian Rupees without decimal places.
 * Examples: 120 → "₹120", 1500 → "₹1,500"
 */
fun Number.toRupeesWhole(): String {
    val formatter = NumberFormat.getCurrencyInstance(Locale("en", "IN"))
    formatter.maximumFractionDigits = 0
    formatter.minimumFractionDigits = 0
    return formatter.format(this)
}

/**
 * Calculates CGST (Central GST) at 2.5% of the given amount.
 */
fun Double.calculateCGST(): Double {
    return this * CGST_RATE
}

/**
 * Calculates SGST (State GST) at 2.5% of the given amount.
 */
fun Double.calculateSGST(): Double {
    return this * SGST_RATE
}

/**
 * Calculates total GST (CGST + SGST = 5%) of the given amount.
 */
fun Double.calculateTotalGST(): Double {
    return this * (CGST_RATE + SGST_RATE)
}

/**
 * Calculates grand total (amount + CGST + SGST).
 */
fun Double.calculateGrandTotal(): Double {
    return this + calculateTotalGST()
}

/**
 * Holds the tax breakdown for a given subtotal.
 */
data class TaxBreakdown(
    val subtotal: Double,
    val cgst: Double,
    val sgst: Double,
    val grandTotal: Double
)

/**
 * Computes a full tax breakdown (CGST, SGST, grand total) from a subtotal.
 */
fun Double.toTaxBreakdown(): TaxBreakdown {
    val cgst = calculateCGST()
    val sgst = calculateSGST()
    return TaxBreakdown(
        subtotal = this,
        cgst = cgst,
        sgst = sgst,
        grandTotal = this + cgst + sgst
    )
}
