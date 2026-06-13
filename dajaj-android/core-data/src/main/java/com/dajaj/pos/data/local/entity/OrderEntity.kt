package com.dajaj.pos.data.local.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Room entity for local order caching.
 * Stores orders created offline and syncs to Firestore when connectivity is restored.
 * Also used to cache orders fetched from Firestore for offline display.
 */
@Entity(
    tableName = "orders",
    indices = [
        Index(value = ["synced"]),
        Index(value = ["status", "createdAt"]),
        Index(value = ["restaurantId", "createdAt"])
    ]
)
data class OrderEntity(
    @PrimaryKey
    val id: String,
    val restaurantId: String,
    val orderNumber: String,
    val channel: String, // walk_in, whatsapp, website, qr, swiggy, zomato
    val type: String, // walk_in, takeaway, dine_in
    val status: String, // pending, accepted, preparing, ready, completed, cancelled
    val customerId: String?,
    val customerName: String?,
    val customerPhone: String?,
    val itemsJson: String, // JSON array of order items
    val subtotal: Double,
    val cgst: Double,
    val sgst: Double,
    val grandTotal: Double,
    val paymentMode: String, // cash, upi, card
    val cashierId: String?,
    val rejectionReason: String?,
    val synced: Boolean = false,
    val createdAt: Long,
    val updatedAt: Long,
    val acceptedAt: Long?,
    val preparingAt: Long?,
    val readyAt: Long?,
    val completedAt: Long?
)
