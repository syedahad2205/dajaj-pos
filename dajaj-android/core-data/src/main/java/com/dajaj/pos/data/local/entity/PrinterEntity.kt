package com.dajaj.pos.data.local.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Room entity for paired Bluetooth printer configurations.
 * Stores printer connection details, role assignment, paper width,
 * and default designation for routing print jobs.
 */
@Entity(
    tableName = "printers",
    indices = [
        Index(value = ["role"]),
        Index(value = ["isDefault"])
    ]
)
data class PrinterEntity(
    @PrimaryKey
    val deviceId: String,
    val name: String,
    val address: String, // Bluetooth MAC address
    val role: String, // kot, bill
    val paperWidth: Int, // 58 or 80 (mm)
    val isDefault: Boolean,
    val status: String, // connected, disconnected, reconnecting
    val lastConnected: Long?
)
