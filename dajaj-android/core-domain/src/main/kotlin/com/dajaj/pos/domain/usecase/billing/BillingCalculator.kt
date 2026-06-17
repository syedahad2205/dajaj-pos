package com.dajaj.pos.domain.usecase.billing

import com.dajaj.pos.domain.model.BillCalculation
import com.dajaj.pos.domain.model.PaymentSplit
import kotlin.math.roundToLong

/**
 * Pure billing calculation logic for the Dajaj POS.
 *
 * Implements tax computation, discount validation, service charge application,
 * cash payment validation, and mixed payment validation.
 *
 * Tax Calculation Formula:
 * ```
 * taxableAmount = subtotal - discountAmount + serviceChargeAmount
 * cgst = taxableAmount × taxRate (default 2.5%, configurable 0-28%)
 * sgst = taxableAmount × taxRate (default 2.5%, configurable 0-28%)
 * grandTotal = taxableAmount + cgst + sgst
 * ```
 *
 * All monetary values are rounded to 2 decimal places.
 *
 * @see <a href="requirements.md">Requirements 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.8</a>
 */
object BillingCalculator {

    private const val MAX_TAX_RATE = 28.0
    private const val MAX_SERVICE_CHARGE_PERCENT = 25.0
    private const val MAX_CASH_AMOUNT = 999_999.99
    private const val MIN_CASH_AMOUNT = 0.01
    private const val MAX_SPLITS = 4
    private const val MAX_DISCOUNT_REASON_LENGTH = 100

    /**
     * Calculates the full bill breakdown given subtotal, optional discount,
     * service charge percentage, and tax rate percentage.
     *
     * @param subtotal The sum of all item line totals. Must be > 0.
     * @param discount Optional discount to apply.
     * @param serviceChargePercent Service charge percentage (0-25%, default 0%).
     * @param taxRatePercent Tax rate percentage for CGST and SGST each (0-28%, default 2.5%).
     * @return [Result] containing [BillCalculation] on success, or failure with error message.
     */
    fun calculateBill(
        subtotal: Double,
        discount: Discount?,
        serviceChargePercent: Double,
        taxRatePercent: Double
    ): Result<BillCalculation> {
        // Validate subtotal
        if (subtotal <= 0) {
            return Result.failure(IllegalArgumentException("Subtotal must be greater than 0"))
        }

        // Validate service charge percent
        if (serviceChargePercent < 0 || serviceChargePercent > MAX_SERVICE_CHARGE_PERCENT) {
            return Result.failure(
                IllegalArgumentException(
                    "Service charge percent must be between 0 and $MAX_SERVICE_CHARGE_PERCENT"
                )
            )
        }

        // Validate tax rate
        if (taxRatePercent < 0 || taxRatePercent > MAX_TAX_RATE) {
            return Result.failure(
                IllegalArgumentException("Tax rate must be between 0 and $MAX_TAX_RATE")
            )
        }

        // Calculate discount amount
        val discountAmount = if (discount != null) {
            val validationResult = validateDiscount(discount, subtotal)
            if (validationResult.isFailure) {
                return Result.failure(validationResult.exceptionOrNull()!!)
            }
            validationResult.getOrThrow()
        } else {
            0.0
        }

        // Service charge applied to (subtotal - discount)
        val afterDiscount = subtotal - discountAmount
        val serviceChargeAmount = roundTo2Decimals(afterDiscount * serviceChargePercent / 100.0)

        // Tax calculation
        val taxableAmount = roundTo2Decimals(afterDiscount + serviceChargeAmount)
        val cgst = roundTo2Decimals(taxableAmount * taxRatePercent / 100.0)
        val sgst = roundTo2Decimals(taxableAmount * taxRatePercent / 100.0)
        val grandTotal = roundTo2Decimals(taxableAmount + cgst + sgst)

        return Result.success(
            BillCalculation(
                subtotal = roundTo2Decimals(subtotal),
                discountAmount = roundTo2Decimals(discountAmount),
                serviceChargeAmount = serviceChargeAmount,
                cgst = cgst,
                sgst = sgst,
                grandTotal = grandTotal
            )
        )
    }

    /**
     * Validates a cash payment and returns the change amount.
     *
     * @param cashCollected Amount of cash collected (0.01 to 999,999.99).
     * @param grandTotal The grand total of the bill.
     * @return [Result] containing the change amount on success, or failure with error message.
     */
    fun validateCashPayment(cashCollected: Double, grandTotal: Double): Result<Double> {
        if (cashCollected < MIN_CASH_AMOUNT || cashCollected > MAX_CASH_AMOUNT) {
            return Result.failure(
                IllegalArgumentException(
                    "Cash collected must be between $MIN_CASH_AMOUNT and $MAX_CASH_AMOUNT"
                )
            )
        }

        if (grandTotal <= 0) {
            return Result.failure(
                IllegalArgumentException("Grand total must be greater than 0")
            )
        }

        if (cashCollected < grandTotal) {
            return Result.failure(
                IllegalArgumentException(
                    "Cash collected must be greater than or equal to the grand total"
                )
            )
        }

        val change = roundTo2Decimals(cashCollected - grandTotal)
        return Result.success(change)
    }

    /**
     * Validates a mixed payment split configuration.
     *
     * @param splits List of payment splits (max 4, each amount > 0).
     * @param grandTotal The grand total that splits must sum to exactly.
     * @return [Result.success] if valid, or failure with error message.
     */
    fun validateMixedPayment(splits: List<PaymentSplit>, grandTotal: Double): Result<Unit> {
        if (splits.isEmpty()) {
            return Result.failure(
                IllegalArgumentException("Mixed payment must have at least one split")
            )
        }

        if (splits.size > MAX_SPLITS) {
            return Result.failure(
                IllegalArgumentException("Mixed payment supports a maximum of $MAX_SPLITS splits")
            )
        }

        if (grandTotal <= 0) {
            return Result.failure(
                IllegalArgumentException("Grand total must be greater than 0")
            )
        }

        // Each split amount must be > 0
        for ((index, split) in splits.withIndex()) {
            if (split.amount <= 0) {
                return Result.failure(
                    IllegalArgumentException("Split ${index + 1} amount must be greater than 0")
                )
            }
        }

        // Sum must equal grand total exactly (to 2 decimal places)
        val sum = roundTo2Decimals(splits.sumOf { it.amount })
        val roundedGrandTotal = roundTo2Decimals(grandTotal)

        if (sum != roundedGrandTotal) {
            return Result.failure(
                IllegalArgumentException(
                    "Sum of splits ($sum) must equal grand total ($roundedGrandTotal)"
                )
            )
        }

        return Result.success(Unit)
    }

    /**
     * Validates a discount and returns the calculated discount amount.
     *
     * @param discount The discount to validate.
     * @param subtotal The order subtotal (discount is applied against this).
     * @return [Result] containing the calculated discount amount, or failure with error message.
     */
    fun validateDiscount(discount: Discount, subtotal: Double): Result<Double> {
        // Validate reason length
        if (discount.reason.isEmpty() || discount.reason.length > MAX_DISCOUNT_REASON_LENGTH) {
            return Result.failure(
                IllegalArgumentException(
                    "Discount reason must be between 1 and $MAX_DISCOUNT_REASON_LENGTH characters"
                )
            )
        }

        if (subtotal <= 0) {
            return Result.failure(
                IllegalArgumentException("Subtotal must be greater than 0 to apply a discount")
            )
        }

        return when (discount.type) {
            DiscountType.PERCENTAGE -> {
                if (discount.value < 0 || discount.value > 100) {
                    Result.failure(
                        IllegalArgumentException("Percentage discount must be between 0 and 100")
                    )
                } else {
                    val amount = roundTo2Decimals(subtotal * discount.value / 100.0)
                    Result.success(amount)
                }
            }
            DiscountType.FIXED -> {
                if (discount.value < 0) {
                    Result.failure(
                        IllegalArgumentException("Fixed discount must not be negative")
                    )
                } else if (discount.value > subtotal) {
                    Result.failure(
                        IllegalArgumentException("Fixed discount must not exceed subtotal")
                    )
                } else {
                    Result.success(roundTo2Decimals(discount.value))
                }
            }
        }
    }

    /**
     * Rounds a Double value to 2 decimal places using banker's rounding approach.
     */
    internal fun roundTo2Decimals(value: Double): Double {
        return (value * 100.0).roundToLong() / 100.0
    }
}
