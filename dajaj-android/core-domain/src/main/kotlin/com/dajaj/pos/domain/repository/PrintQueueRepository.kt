package com.dajaj.pos.domain.repository

import com.dajaj.pos.common.Result
import com.dajaj.pos.domain.model.PrintJob
import com.dajaj.pos.domain.model.PrintJobType
import kotlinx.coroutines.flow.Flow

/**
 * Repository interface for print queue operations.
 *
 * Manages the Firestore-backed print job queue with offline fallback to Room.
 * All print operations (KOT, customer bill, reprint) flow through this queue.
 * The Print Agent foreground service observes pending jobs and processes them
 * via Bluetooth printers using FIFO ordering.
 *
 * Offline handling: if Firestore is unreachable, jobs are stored in Room Database
 * with their original `createdAt` timestamp and synced within 30s of connectivity restoration.
 */
interface PrintQueueRepository {

    /**
     * Creates a new print job in Firestore with status PENDING.
     * If offline, persists to Room Database for later sync.
     *
     * @param job The print job details to create
     * @return Result containing the created job's document ID
     */
    suspend fun createPrintJob(job: NewPrintJob): Result<String>

    /**
     * Observes pending print jobs for the current restaurant as a reactive [Flow].
     * Only jobs with status PENDING are emitted, sorted by creation time ascending (FIFO).
     *
     * @return Flow emitting the current list of pending print jobs in real-time
     */
    fun observePendingJobs(): Flow<List<PrintJob>>

    /**
     * Atomically claims a pending print job for a device using a Firestore transaction.
     * Transitions job status from PENDING to PROCESSING and sets the claimedBy field.
     * Fails if the job is no longer PENDING (already claimed by another device).
     *
     * @param jobId The ID of the print job to claim
     * @param deviceId The device identifier claiming the job
     * @return Result indicating success or failure (e.g., already claimed)
     */
    suspend fun claimJob(jobId: String, deviceId: String): Result<Unit>

    /**
     * Marks a print job as COMPLETED after successful printing.
     * Sets the completedAt timestamp.
     *
     * @param jobId The ID of the print job to mark as completed
     * @return Result indicating success or failure
     */
    suspend fun completeJob(jobId: String): Result<Unit>

    /**
     * Marks a print job as FAILED after all retry attempts are exhausted.
     * Records the failure reason for display in notifications.
     *
     * @param jobId The ID of the print job that failed
     * @param reason Description of why the print operation failed
     * @return Result indicating success or failure
     */
    suspend fun failJob(jobId: String, reason: String): Result<Unit>

    /**
     * Resets a FAILED print job back to PENDING for manual retry.
     * Clears the claimedBy, failureReason, claimedAt, and completedAt fields,
     * and resets retryCount to 0.
     *
     * @param jobId The ID of the failed print job to retry
     * @return Result indicating success or failure
     */
    suspend fun retryJob(jobId: String): Result<Unit>

    /**
     * Returns all print jobs queued locally in Room Database (not yet synced to Firestore).
     * Used by the sync worker to identify jobs that need to be uploaded.
     */
    suspend fun getLocalQueuedJobs(): List<PrintJob>

    /**
     * Synchronizes all locally stored print jobs to Firestore.
     * Jobs are synced in chronological order (oldest createdAt first).
     * Should be called within 30 seconds of connectivity restoration.
     *
     * @return Result indicating success or failure of the sync operation
     */
    suspend fun syncLocalJobs(): Result<Unit>
}

/**
 * Data class for creating a new print job.
 *
 * Contains all required fields to construct a print_jobs document in Firestore.
 */
data class NewPrintJob(
    /** The type of print content (KOT, customer bill, or reprint). */
    val jobType: PrintJobType,

    /** Target printer type — "kot" or "bill". */
    val printerType: String,

    /** The order this print job is associated with. */
    val orderId: String,

    /** Human-readable order number (format: DDMMYY####). */
    val orderNumber: String,

    /** Print payload containing the formatted content to send to the printer. */
    val payload: Map<String, Any>,

    /** Origin of the print request: "android_pos" or "web_dashboard". */
    val source: PrintSource
)

/**
 * Source of a print job request.
 */
enum class PrintSource {
    ANDROID_POS,
    WEB_DASHBOARD;

    fun toFirestoreValue(): String = when (this) {
        ANDROID_POS -> "android_pos"
        WEB_DASHBOARD -> "web_dashboard"
    }
}
