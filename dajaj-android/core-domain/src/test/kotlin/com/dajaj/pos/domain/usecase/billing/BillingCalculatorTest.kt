package com.dajaj.pos.domain.usecase.billing

import com.dajaj.pos.domain.model.PaymentMethod
import com.dajaj.pos.domain.model.PaymentSplit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BillingCalculatorTest {

    // =========================================================================
    // calculateBill — Tax Calculation Formula
    // =========================================================================

    @Test
    fun `calculateBill with no discount and no service charge applies tax correctly`() {
        val result = BillingCalculator.calculateBill(
            subtotal = 1000.0,
            discount = null,
            serviceChargePercent = 0.0,
            taxRatePercent = 2.5
        )

        assertTrue(result.isSuccess)
        val bill = result.getOrThrow()
        assertEquals(1000.0, bill.subtotal, 0.001)
        assertEquals(0.0, bill.discountAmount, 0.001)
        assertEquals(0.0, bill.serviceChargeAmount, 0.001)
        // taxableAmount = 1000 - 0 + 0 = 1000
        // cgst = 1000 * 2.5 / 100 = 25.0
        assertEquals(25.0, bill.cgst, 0.001)
        assertEquals(25.0, bill.sgst, 0.001)
        // grandTotal = 1000 + 25 + 25 = 1050
        assertEquals(1050.0, bill.grandTotal, 0.001)
    }

    @Test
    fun `calculateBill with percentage discount deducts correctly`() {
        val result = BillingCalculator.calculateBill(
            subtotal = 500.0,
            discount = Discount(DiscountType.PERCENTAGE, 10.0, "Loyalty discount"),
            serviceChargePercent = 0.0,
            taxRatePercent = 2.5
        )

        assertTrue(result.isSuccess)
        val bill = result.getOrThrow()
        // discountAmount = 500 * 10 / 100 = 50
        assertEquals(50.0, bill.discountAmount, 0.001)
        // taxableAmount = 500 - 50 + 0 = 450
        // cgst = 450 * 2.5 / 100 = 11.25
        assertEquals(11.25, bill.cgst, 0.001)
        assertEquals(11.25, bill.sgst, 0.001)
        // grandTotal = 450 + 11.25 + 11.25 = 472.5
        assertEquals(472.5, bill.grandTotal, 0.001)
    }

    @Test
    fun `calculateBill with fixed discount deducts correctly`() {
        val result = BillingCalculator.calculateBill(
            subtotal = 800.0,
            discount = Discount(DiscountType.FIXED, 100.0, "Manager special"),
            serviceChargePercent = 0.0,
            taxRatePercent = 5.0
        )

        assertTrue(result.isSuccess)
        val bill = result.getOrThrow()
        assertEquals(100.0, bill.discountAmount, 0.001)
        // taxableAmount = 800 - 100 + 0 = 700
        // cgst = 700 * 5 / 100 = 35
        assertEquals(35.0, bill.cgst, 0.001)
        assertEquals(35.0, bill.sgst, 0.001)
        // grandTotal = 700 + 35 + 35 = 770
        assertEquals(770.0, bill.grandTotal, 0.001)
    }

    @Test
    fun `calculateBill with service charge applies to subtotal minus discount`() {
        val result = BillingCalculator.calculateBill(
            subtotal = 1000.0,
            discount = Discount(DiscountType.FIXED, 200.0, "Promo"),
            serviceChargePercent = 10.0,
            taxRatePercent = 2.5
        )

        assertTrue(result.isSuccess)
        val bill = result.getOrThrow()
        // afterDiscount = 1000 - 200 = 800
        // serviceChargeAmount = 800 * 10 / 100 = 80
        assertEquals(80.0, bill.serviceChargeAmount, 0.001)
        // taxableAmount = 800 + 80 = 880
        // cgst = 880 * 2.5 / 100 = 22
        assertEquals(22.0, bill.cgst, 0.001)
        assertEquals(22.0, bill.sgst, 0.001)
        // grandTotal = 880 + 22 + 22 = 924
        assertEquals(924.0, bill.grandTotal, 0.001)
    }

    @Test
    fun `calculateBill with all components applies formula correctly`() {
        val result = BillingCalculator.calculateBill(
            subtotal = 1200.0,
            discount = Discount(DiscountType.PERCENTAGE, 20.0, "Festival offer"),
            serviceChargePercent = 5.0,
            taxRatePercent = 9.0
        )

        assertTrue(result.isSuccess)
        val bill = result.getOrThrow()
        // discountAmount = 1200 * 20 / 100 = 240
        assertEquals(240.0, bill.discountAmount, 0.001)
        // afterDiscount = 1200 - 240 = 960
        // serviceCharge = 960 * 5 / 100 = 48
        assertEquals(48.0, bill.serviceChargeAmount, 0.001)
        // taxableAmount = 960 + 48 = 1008
        // cgst = 1008 * 9 / 100 = 90.72
        assertEquals(90.72, bill.cgst, 0.001)
        assertEquals(90.72, bill.sgst, 0.001)
        // grandTotal = 1008 + 90.72 + 90.72 = 1189.44
        assertEquals(1189.44, bill.grandTotal, 0.001)
    }

    @Test
    fun `calculateBill rounds monetary values to 2 decimal places`() {
        // Use values that produce repeating decimals
        val result = BillingCalculator.calculateBill(
            subtotal = 333.33,
            discount = null,
            serviceChargePercent = 0.0,
            taxRatePercent = 2.5
        )

        assertTrue(result.isSuccess)
        val bill = result.getOrThrow()
        // cgst = 333.33 * 2.5 / 100 = 8.33325 → rounded to 8.33
        assertEquals(8.33, bill.cgst, 0.001)
        assertEquals(8.33, bill.sgst, 0.001)
        // grandTotal = 333.33 + 8.33 + 8.33 = 349.99
        assertEquals(349.99, bill.grandTotal, 0.001)
    }

    @Test
    fun `calculateBill with zero tax rate produces zero tax`() {
        val result = BillingCalculator.calculateBill(
            subtotal = 500.0,
            discount = null,
            serviceChargePercent = 0.0,
            taxRatePercent = 0.0
        )

        assertTrue(result.isSuccess)
        val bill = result.getOrThrow()
        assertEquals(0.0, bill.cgst, 0.001)
        assertEquals(0.0, bill.sgst, 0.001)
        assertEquals(500.0, bill.grandTotal, 0.001)
    }

    @Test
    fun `calculateBill with max tax rate 28 percent`() {
        val result = BillingCalculator.calculateBill(
            subtotal = 100.0,
            discount = null,
            serviceChargePercent = 0.0,
            taxRatePercent = 28.0
        )

        assertTrue(result.isSuccess)
        val bill = result.getOrThrow()
        // cgst = 100 * 28 / 100 = 28
        assertEquals(28.0, bill.cgst, 0.001)
        assertEquals(28.0, bill.sgst, 0.001)
        // grandTotal = 100 + 28 + 28 = 156
        assertEquals(156.0, bill.grandTotal, 0.001)
    }

    @Test
    fun `calculateBill with max service charge 25 percent`() {
        val result = BillingCalculator.calculateBill(
            subtotal = 400.0,
            discount = null,
            serviceChargePercent = 25.0,
            taxRatePercent = 2.5
        )

        assertTrue(result.isSuccess)
        val bill = result.getOrThrow()
        // serviceCharge = 400 * 25 / 100 = 100
        assertEquals(100.0, bill.serviceChargeAmount, 0.001)
        // taxableAmount = 400 + 100 = 500
        // cgst = 500 * 2.5 / 100 = 12.5
        assertEquals(12.5, bill.cgst, 0.001)
        assertEquals(12.5, bill.sgst, 0.001)
        // grandTotal = 500 + 12.5 + 12.5 = 525
        assertEquals(525.0, bill.grandTotal, 0.001)
    }

    // =========================================================================
    // calculateBill — Validation Errors
    // =========================================================================

    @Test
    fun `calculateBill fails when subtotal is zero`() {
        val result = BillingCalculator.calculateBill(
            subtotal = 0.0,
            discount = null,
            serviceChargePercent = 0.0,
            taxRatePercent = 2.5
        )

        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull()?.message?.contains("Subtotal") == true)
    }

    @Test
    fun `calculateBill fails when subtotal is negative`() {
        val result = BillingCalculator.calculateBill(
            subtotal = -100.0,
            discount = null,
            serviceChargePercent = 0.0,
            taxRatePercent = 2.5
        )

        assertTrue(result.isFailure)
    }

    @Test
    fun `calculateBill fails when service charge exceeds 25 percent`() {
        val result = BillingCalculator.calculateBill(
            subtotal = 100.0,
            discount = null,
            serviceChargePercent = 26.0,
            taxRatePercent = 2.5
        )

        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull()?.message?.contains("Service charge") == true)
    }

    @Test
    fun `calculateBill fails when service charge is negative`() {
        val result = BillingCalculator.calculateBill(
            subtotal = 100.0,
            discount = null,
            serviceChargePercent = -1.0,
            taxRatePercent = 2.5
        )

        assertTrue(result.isFailure)
    }

    @Test
    fun `calculateBill fails when tax rate exceeds 28 percent`() {
        val result = BillingCalculator.calculateBill(
            subtotal = 100.0,
            discount = null,
            serviceChargePercent = 0.0,
            taxRatePercent = 29.0
        )

        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull()?.message?.contains("Tax rate") == true)
    }

    @Test
    fun `calculateBill fails when tax rate is negative`() {
        val result = BillingCalculator.calculateBill(
            subtotal = 100.0,
            discount = null,
            serviceChargePercent = 0.0,
            taxRatePercent = -1.0
        )

        assertTrue(result.isFailure)
    }

    @Test
    fun `calculateBill fails when discount reason is empty`() {
        val result = BillingCalculator.calculateBill(
            subtotal = 100.0,
            discount = Discount(DiscountType.FIXED, 10.0, ""),
            serviceChargePercent = 0.0,
            taxRatePercent = 2.5
        )

        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull()?.message?.contains("reason") == true)
    }

    @Test
    fun `calculateBill fails when fixed discount exceeds subtotal`() {
        val result = BillingCalculator.calculateBill(
            subtotal = 100.0,
            discount = Discount(DiscountType.FIXED, 150.0, "Big discount"),
            serviceChargePercent = 0.0,
            taxRatePercent = 2.5
        )

        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull()?.message?.contains("exceed subtotal") == true)
    }

    // =========================================================================
    // validateDiscount
    // =========================================================================

    @Test
    fun `validateDiscount percentage returns correct amount`() {
        val discount = Discount(DiscountType.PERCENTAGE, 15.0, "Staff discount")
        val result = BillingCalculator.validateDiscount(discount, 200.0)

        assertTrue(result.isSuccess)
        assertEquals(30.0, result.getOrThrow(), 0.001)
    }

    @Test
    fun `validateDiscount 100 percent returns full subtotal`() {
        val discount = Discount(DiscountType.PERCENTAGE, 100.0, "Complimentary")
        val result = BillingCalculator.validateDiscount(discount, 500.0)

        assertTrue(result.isSuccess)
        assertEquals(500.0, result.getOrThrow(), 0.001)
    }

    @Test
    fun `validateDiscount 0 percent returns zero`() {
        val discount = Discount(DiscountType.PERCENTAGE, 0.0, "No discount")
        val result = BillingCalculator.validateDiscount(discount, 500.0)

        assertTrue(result.isSuccess)
        assertEquals(0.0, result.getOrThrow(), 0.001)
    }

    @Test
    fun `validateDiscount fixed returns exact value`() {
        val discount = Discount(DiscountType.FIXED, 75.0, "Coupon")
        val result = BillingCalculator.validateDiscount(discount, 200.0)

        assertTrue(result.isSuccess)
        assertEquals(75.0, result.getOrThrow(), 0.001)
    }

    @Test
    fun `validateDiscount fixed equal to subtotal succeeds`() {
        val discount = Discount(DiscountType.FIXED, 200.0, "Full comp")
        val result = BillingCalculator.validateDiscount(discount, 200.0)

        assertTrue(result.isSuccess)
        assertEquals(200.0, result.getOrThrow(), 0.001)
    }

    @Test
    fun `validateDiscount fails when percentage exceeds 100`() {
        val discount = Discount(DiscountType.PERCENTAGE, 101.0, "Invalid")
        val result = BillingCalculator.validateDiscount(discount, 200.0)

        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull()?.message?.contains("between 0 and 100") == true)
    }

    @Test
    fun `validateDiscount fails when percentage is negative`() {
        val discount = Discount(DiscountType.PERCENTAGE, -5.0, "Invalid")
        val result = BillingCalculator.validateDiscount(discount, 200.0)

        assertTrue(result.isFailure)
    }

    @Test
    fun `validateDiscount fails when fixed discount exceeds subtotal`() {
        val discount = Discount(DiscountType.FIXED, 300.0, "Too much")
        val result = BillingCalculator.validateDiscount(discount, 200.0)

        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull()?.message?.contains("exceed subtotal") == true)
    }

    @Test
    fun `validateDiscount fails when fixed discount is negative`() {
        val discount = Discount(DiscountType.FIXED, -10.0, "Negative")
        val result = BillingCalculator.validateDiscount(discount, 200.0)

        assertTrue(result.isFailure)
    }

    @Test
    fun `validateDiscount fails when reason is empty`() {
        val discount = Discount(DiscountType.FIXED, 10.0, "")
        val result = BillingCalculator.validateDiscount(discount, 200.0)

        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull()?.message?.contains("reason") == true)
    }

    @Test
    fun `validateDiscount fails when reason exceeds 100 characters`() {
        val longReason = "a".repeat(101)
        val discount = Discount(DiscountType.FIXED, 10.0, longReason)
        val result = BillingCalculator.validateDiscount(discount, 200.0)

        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull()?.message?.contains("reason") == true)
    }

    @Test
    fun `validateDiscount succeeds with reason at max 100 characters`() {
        val maxReason = "a".repeat(100)
        val discount = Discount(DiscountType.FIXED, 10.0, maxReason)
        val result = BillingCalculator.validateDiscount(discount, 200.0)

        assertTrue(result.isSuccess)
    }

    @Test
    fun `validateDiscount succeeds with reason of 1 character`() {
        val discount = Discount(DiscountType.FIXED, 10.0, "x")
        val result = BillingCalculator.validateDiscount(discount, 200.0)

        assertTrue(result.isSuccess)
    }

    @Test
    fun `validateDiscount fails when subtotal is zero`() {
        val discount = Discount(DiscountType.FIXED, 0.0, "Test")
        val result = BillingCalculator.validateDiscount(discount, 0.0)

        assertTrue(result.isFailure)
    }

    // =========================================================================
    // validateCashPayment
    // =========================================================================

    @Test
    fun `validateCashPayment returns zero change when exact amount`() {
        val result = BillingCalculator.validateCashPayment(500.0, 500.0)

        assertTrue(result.isSuccess)
        assertEquals(0.0, result.getOrThrow(), 0.001)
    }

    @Test
    fun `validateCashPayment returns correct change`() {
        val result = BillingCalculator.validateCashPayment(1000.0, 750.0)

        assertTrue(result.isSuccess)
        assertEquals(250.0, result.getOrThrow(), 0.001)
    }

    @Test
    fun `validateCashPayment with decimal change`() {
        val result = BillingCalculator.validateCashPayment(100.0, 87.50)

        assertTrue(result.isSuccess)
        assertEquals(12.50, result.getOrThrow(), 0.001)
    }

    @Test
    fun `validateCashPayment fails when cash less than grand total`() {
        val result = BillingCalculator.validateCashPayment(400.0, 500.0)

        assertTrue(result.isFailure)
        assertTrue(
            result.exceptionOrNull()?.message?.contains("greater than or equal") == true
        )
    }

    @Test
    fun `validateCashPayment fails when cash is below minimum`() {
        val result = BillingCalculator.validateCashPayment(0.0, 0.01)

        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull()?.message?.contains("between") == true)
    }

    @Test
    fun `validateCashPayment fails when cash exceeds maximum`() {
        val result = BillingCalculator.validateCashPayment(1_000_000.0, 500.0)

        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull()?.message?.contains("between") == true)
    }

    @Test
    fun `validateCashPayment succeeds at minimum cash amount`() {
        val result = BillingCalculator.validateCashPayment(0.01, 0.01)

        assertTrue(result.isSuccess)
        assertEquals(0.0, result.getOrThrow(), 0.001)
    }

    @Test
    fun `validateCashPayment succeeds at maximum cash amount`() {
        val result = BillingCalculator.validateCashPayment(999_999.99, 100.0)

        assertTrue(result.isSuccess)
        assertEquals(999_899.99, result.getOrThrow(), 0.001)
    }

    @Test
    fun `validateCashPayment fails when grand total is zero`() {
        val result = BillingCalculator.validateCashPayment(100.0, 0.0)

        assertTrue(result.isFailure)
    }

    @Test
    fun `validateCashPayment fails when grand total is negative`() {
        val result = BillingCalculator.validateCashPayment(100.0, -10.0)

        assertTrue(result.isFailure)
    }

    // =========================================================================
    // validateMixedPayment
    // =========================================================================

    @Test
    fun `validateMixedPayment succeeds with valid splits summing to grand total`() {
        val splits = listOf(
            PaymentSplit(PaymentMethod.CASH, 300.0),
            PaymentSplit(PaymentMethod.CARD, 200.0)
        )
        val result = BillingCalculator.validateMixedPayment(splits, 500.0)

        assertTrue(result.isSuccess)
    }

    @Test
    fun `validateMixedPayment succeeds with 4 splits`() {
        val splits = listOf(
            PaymentSplit(PaymentMethod.CASH, 100.0),
            PaymentSplit(PaymentMethod.CARD, 150.0),
            PaymentSplit(PaymentMethod.UPI, 200.0),
            PaymentSplit(PaymentMethod.CASH, 50.0)
        )
        val result = BillingCalculator.validateMixedPayment(splits, 500.0)

        assertTrue(result.isSuccess)
    }

    @Test
    fun `validateMixedPayment succeeds with single split equalling grand total`() {
        val splits = listOf(
            PaymentSplit(PaymentMethod.UPI, 1000.0)
        )
        val result = BillingCalculator.validateMixedPayment(splits, 1000.0)

        assertTrue(result.isSuccess)
    }

    @Test
    fun `validateMixedPayment fails with empty splits`() {
        val result = BillingCalculator.validateMixedPayment(emptyList(), 500.0)

        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull()?.message?.contains("at least one") == true)
    }

    @Test
    fun `validateMixedPayment fails with more than 4 splits`() {
        val splits = listOf(
            PaymentSplit(PaymentMethod.CASH, 100.0),
            PaymentSplit(PaymentMethod.CARD, 100.0),
            PaymentSplit(PaymentMethod.UPI, 100.0),
            PaymentSplit(PaymentMethod.CASH, 100.0),
            PaymentSplit(PaymentMethod.CARD, 100.0)
        )
        val result = BillingCalculator.validateMixedPayment(splits, 500.0)

        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull()?.message?.contains("maximum of 4") == true)
    }

    @Test
    fun `validateMixedPayment fails when a split has zero amount`() {
        val splits = listOf(
            PaymentSplit(PaymentMethod.CASH, 500.0),
            PaymentSplit(PaymentMethod.CARD, 0.0)
        )
        val result = BillingCalculator.validateMixedPayment(splits, 500.0)

        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull()?.message?.contains("greater than 0") == true)
    }

    @Test
    fun `validateMixedPayment fails when a split has negative amount`() {
        val splits = listOf(
            PaymentSplit(PaymentMethod.CASH, 600.0),
            PaymentSplit(PaymentMethod.CARD, -100.0)
        )
        val result = BillingCalculator.validateMixedPayment(splits, 500.0)

        assertTrue(result.isFailure)
    }

    @Test
    fun `validateMixedPayment fails when sum does not equal grand total`() {
        val splits = listOf(
            PaymentSplit(PaymentMethod.CASH, 300.0),
            PaymentSplit(PaymentMethod.CARD, 100.0)
        )
        val result = BillingCalculator.validateMixedPayment(splits, 500.0)

        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull()?.message?.contains("must equal grand total") == true)
    }

    @Test
    fun `validateMixedPayment validates to 2 decimal places`() {
        val splits = listOf(
            PaymentSplit(PaymentMethod.CASH, 333.33),
            PaymentSplit(PaymentMethod.CARD, 166.67)
        )
        val result = BillingCalculator.validateMixedPayment(splits, 500.0)

        assertTrue(result.isSuccess)
    }

    @Test
    fun `validateMixedPayment fails when grand total is zero`() {
        val splits = listOf(
            PaymentSplit(PaymentMethod.CASH, 0.01)
        )
        val result = BillingCalculator.validateMixedPayment(splits, 0.0)

        assertTrue(result.isFailure)
    }

    // =========================================================================
    // roundTo2Decimals
    // =========================================================================

    @Test
    fun `roundTo2Decimals rounds correctly`() {
        assertEquals(10.12, BillingCalculator.roundTo2Decimals(10.124), 0.001)
        assertEquals(10.13, BillingCalculator.roundTo2Decimals(10.125), 0.001)
        assertEquals(10.13, BillingCalculator.roundTo2Decimals(10.126), 0.001)
        assertEquals(0.0, BillingCalculator.roundTo2Decimals(0.0), 0.001)
        assertEquals(99.99, BillingCalculator.roundTo2Decimals(99.994), 0.001)
    }

    // =========================================================================
    // Integration: Full bill calculation scenario
    // =========================================================================

    @Test
    fun `full billing scenario with discount, service charge, and tax`() {
        // Real-world scenario: Order with ₹1500 subtotal, 10% discount,
        // 5% service charge, and default 2.5% tax
        val result = BillingCalculator.calculateBill(
            subtotal = 1500.0,
            discount = Discount(DiscountType.PERCENTAGE, 10.0, "Happy Hour"),
            serviceChargePercent = 5.0,
            taxRatePercent = 2.5
        )

        assertTrue(result.isSuccess)
        val bill = result.getOrThrow()
        assertEquals(1500.0, bill.subtotal, 0.001)
        // discount = 1500 * 10 / 100 = 150
        assertEquals(150.0, bill.discountAmount, 0.001)
        // afterDiscount = 1500 - 150 = 1350
        // serviceCharge = 1350 * 5 / 100 = 67.5
        assertEquals(67.5, bill.serviceChargeAmount, 0.001)
        // taxableAmount = 1350 + 67.5 = 1417.5
        // cgst = 1417.5 * 2.5 / 100 = 35.4375 → 35.44
        assertEquals(35.44, bill.cgst, 0.001)
        assertEquals(35.44, bill.sgst, 0.001)
        // grandTotal = 1417.5 + 35.44 + 35.44 = 1488.38
        assertEquals(1488.38, bill.grandTotal, 0.001)
    }
}
