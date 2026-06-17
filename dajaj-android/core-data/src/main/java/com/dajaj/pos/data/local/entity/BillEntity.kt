package com.dajaj.pos.data.local.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Room entity for persisted bill records.
 * Stores complete billing details including tax breakdown, payment info,
 * and sync status for offline bill creation.
 */
@Entity(
    tableName = "bills",
    indices = [
        Index(value = ["restaurantId", "createdAt"]),
        Index(value = ["synced"]),
        Index(value = ["orderNumber"])
    ]
)
data class BillEntity(
    @PrimaryKey
    val id: String,
    val billNo: String, // Sequential bill number (>1000)
    val orderNumber: String,
    val restaurantId: String,
    val orderType: String, // walk_in, takeaway, dine_in
    val channel: String, // walk_in, whatsapp, website, qr
    val itemsJson: String, // JSON array of bill items
    val subtotal: Double,
    val discountAmount: Double,
    val discountType: String?, // percentage, fixed
    val discountValue: Double?,
    val discountReason: String?,
    val serviceChargePercent: Double,
    val serviceChargeAmount: Double,
    val cgst: Double,
    val sgst: Double,
    val grandTotal: Double,
    val paymentMode: String, // cash, card, upi, mixed
    val cashCollected: Double?,
    val paymentSplitsJson: String?, // JSON array of payment splits
    val punchedBy: String?, // Cashier ID
    val customerName: String?,
    val customerPhone: String?,
    val publicToken: String?, // UUID for customer bill access
    val createdAt: Long,
    val synced: Boolean = false
)
