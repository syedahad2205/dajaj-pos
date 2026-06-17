package com.dajaj.pos.domain.model

/**
 * Value object representing customer information attached to an order or bill.
 *
 * Validation rules:
 * - [name]: 1–100 characters
 * - [phone]: 10-digit Indian mobile number, first digit must be 6, 7, 8, or 9
 */
data class CustomerInfo(
    /** Customer name (1-100 chars). */
    val name: String,

    /** Customer phone (10-digit Indian mobile starting with 6-9, or empty for walk-in). */
    val phone: String
)
