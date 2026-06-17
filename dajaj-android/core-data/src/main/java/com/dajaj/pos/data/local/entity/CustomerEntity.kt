package com.dajaj.pos.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Room entity for customer records.
 * Keyed by phone number (10-digit Indian mobile) for repeat-customer identification.
 * Used for auto-fill on order creation and customer history lookups.
 */
@Entity(tableName = "customers")
data class CustomerEntity(
    @PrimaryKey
    val phone: String, // 10-digit Indian mobile, starts with 6-9
    val name: String, // 1-100 characters
    val lastOrderAt: Long?,
    val createdAt: Long
)
