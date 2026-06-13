package com.dajaj.pos.data.local.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Room entity for local print job queue.
 * Queues print jobs when the Bluetooth printer is disconnected or
 * internet is unavailable. Jobs are processed in FIFO order on reconnection.
 * Maximum queue size: 500 jobs (enforced at repository level).
 */
@Entity(
    tableName = "print_jobs",
    indices = [
        Index(value = ["status", "createdAt"]),
        Index(value = ["restaurantId", "status"])
    ]
)
data class PrintJobEntity(
    @PrimaryKey
    val id: String,
    val restaurantId: String,
    val jobType: String, // kot, customer_bill, reprint
    val printerType: String, // kot, bill
    val status: String, // pending, processing, completed, failed
    val claimedBy: String?, // deviceId that claimed this job
    val orderId: String?,
    val orderNumber: String?,
    val payloadJson: String, // JSON payload with print content
    val retryCount: Int = 0,
    val failureReason: String?,
    val source: String?, // android_pos, web_dashboard
    val createdAt: Long,
    val claimedAt: Long?,
    val completedAt: Long?
)
