package com.dajaj.pos.domain.model

/**
 * Domain validation functions for user input in the Dajaj POS system.
 *
 * All validation follows Indian business conventions:
 * - Phone numbers: 10-digit Indian mobile numbers starting with 6-9
 * - Names: non-empty, max 100 characters
 * - Reasons: non-empty with appropriate max lengths
 */
object Validators {

    /**
     * Validates an Indian mobile phone number.
     *
     * Rules:
     * - Exactly 10 digits
     * - First digit must be 6, 7, 8, or 9
     *
     * @param phone The phone number string to validate.
     * @return `true` if the phone number is valid, `false` otherwise.
     */
    fun validatePhone(phone: String): Boolean {
        if (phone.length != 10) return false
        if (!phone.all { it.isDigit() }) return false
        return phone[0] in listOf('6', '7', '8', '9')
    }

    /**
     * Validates a customer name.
     *
     * Rules:
     * - 1 to 100 characters (inclusive)
     * - Must not be blank (whitespace-only is invalid)
     *
     * @param name The customer name to validate.
     * @return `true` if the name is valid, `false` otherwise.
     */
    fun validateCustomerName(name: String): Boolean {
        return name.isNotBlank() && name.length in 1..100
    }

    /**
     * Validates an order rejection reason.
     *
     * Rules:
     * - 1 to 200 characters (inclusive)
     * - Must not be blank
     *
     * @param reason The rejection reason to validate.
     * @return `true` if the reason is valid, `false` otherwise.
     */
    fun validateRejectionReason(reason: String): Boolean {
        return reason.isNotBlank() && reason.length in 1..200
    }

    /**
     * Validates a discount reason.
     *
     * Rules:
     * - 1 to 100 characters (inclusive)
     * - Must not be blank
     *
     * @param reason The discount reason to validate.
     * @return `true` if the reason is valid, `false` otherwise.
     */
    fun validateDiscountReason(reason: String): Boolean {
        return reason.isNotBlank() && reason.length in 1..100
    }
}
