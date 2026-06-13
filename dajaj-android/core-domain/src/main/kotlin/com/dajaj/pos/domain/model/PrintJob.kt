package com.dajaj.pos.domain.model

/**
 * Domain model representing a print job in the Firestore-backed print queue.
 *
 * All print operations (KOT, customer bill, reprint) flow through this queue.
 * The Android Print Agent foreground service observes PENDING jobs and processes them
 * via Bluetooth printers. Remote print requests from the Web Dashboard also arrive
 * as PrintJob documents in Firestore.
 */
data class PrintJob(
    /** Unique job identifier (Firestore document ID). */
    val id: String,

    /** Restaurant this print job belongs to. */
    val restaurantId: String,

    /** The type of print content (KOT, customer bill, or reprint). */
    val jobType: PrintJobType,

    /** Target printer type — determines which paired printer receives the job. */
    val printerType: String,

    /** Current lifecycle status of the job. */
    val status: PrintJobStatus,

    /** Device ID of the print agent that claimed this job, or null if unclaimed. */
    val claimedBy: String?,

    /** The order this print job is associated with. */
    val orderId: String,

    /** Human-readable order number (format: DDMMYY####). */
    val orderNumber: String,

    /** Print payload containing the formatted content to send to the printer. */
    val payload: Map<String, Any>,

    /** Number of times this job has been retried after failure. */
    val retryCount: Int,

    /** Reason for failure if the job is in FAILED status, null otherwise. */
    val failureReason: String?,

    /** Origin of the print request: "android_pos" or "web_dashboard". */
    val source: String,

    /** Timestamp when the job was created (epoch millis). */
    val createdAt: Long,

    /** Timestamp when the job was claimed by an agent (epoch millis), null if unclaimed. */
    val claimedAt: Long?,

    /** Timestamp when the job completed or failed (epoch millis), null if not finished. */
    val completedAt: Long?
)
