package com.dajaj.pos.domain.repository

import com.dajaj.pos.common.Result
import com.dajaj.pos.domain.model.PrintJob
import kotlinx.coroutines.flow.Flow

/**
 * Repository interface for print job queue operations.
 *
 * Provides real-time observation of pending print jobs, atomic claiming,
 * status updates, and job creation. Implementations handle Firestore
 * transactions for duplicate prevention and local Room DB fallback for offline.
 */
interface PrintJobRepository {

    /**
     * Observes pending print jobs for a given restaurant as a reactive [Flow].
     * Only jobs with status PENDING are emitted, sorted by creation time ascending.
     *
     * Used by the Print Agent foreground service to detect new work.
     *
     * @param restaurantId The restaurant to observe pending jobs for
     * @return Flow emitting the current list of pending print jobs in real-time
     */
    fun observePendingJobs(restaurantId: String): Flow<List<PrintJob>>

    /**
     * Atomically claims a pending print job for this device using a Firestore transaction.
     * The job status transitions from PENDING to PROCESSING and the claimedBy field
     * is set to [deviceId]. The operation fails if the job is no longer PENDING.
     *
     * @param jobId The ID of the print job to claim
     * @param deviceId The device identifier claiming the job
     * @return Result indicating success or failure (e.g., already claimed by another device)
     */
    suspend fun claimJob(jobId: String, deviceId: String): Result<Unit>

    /**
     * Marks a print job as COMPLETED after successful printing.
     * Sets the completedAt timestamp.
     *
     * @param jobId The ID of the print job to mark as completed
     * @return Result indicating success or failure
     */
    suspend fun markCompleted(jobId: String): Result<Unit>

    /**
     * Marks a print job as FAILED after all retry attempts are exhausted.
     * Records the failure reason for display in notifications.
     *
     * @param jobId The ID of the print job that failed
     * @param reason Description of why the print operation failed
     * @return Result indicating success or failure
     */
    suspend fun markFailed(jobId: String, reason: String): Result<Unit>

    /**
     * Creates a new print job in Firestore with status PENDING.
     * The job will be picked up by the Print Agent's real-time listener.
     *
     * @param printJob The print job to create (id field may be empty; Firestore generates it)
     * @return Result containing the created job's Firestore document ID
     */
    suspend fun createPrintJob(printJob: PrintJob): Result<String>

    /**
     * Resets a FAILED print job back to PENDING for manual retry.
     * Clears the claimedBy, failureReason, claimedAt, and completedAt fields,
     * and resets retryCount to 0.
     *
     * @param jobId The ID of the failed print job to retry
     * @return Result indicating success or failure
     */
    suspend fun resetToRetry(jobId: String): Result<Unit>
}
