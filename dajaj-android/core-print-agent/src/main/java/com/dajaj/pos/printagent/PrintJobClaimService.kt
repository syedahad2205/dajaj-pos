package com.dajaj.pos.printagent

import com.dajaj.pos.common.Result
import com.dajaj.pos.data.di.PrintJobsCollection
import com.google.firebase.Timestamp
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.delay
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Service responsible for atomically claiming print jobs from Firestore.
 *
 * Uses Firestore transactions to prevent duplicate printing:
 * - Reads the job document status
 * - Verifies it is still PENDING
 * - Atomically updates to PROCESSING + sets claimedBy and claimedAt
 *
 * Only the primary printer device should invoke claiming logic.
 * Non-primary devices ignore PENDING jobs.
 *
 * Requirements: 8.3, 8.4, 7.8
 */
@Singleton
class PrintJobClaimService @Inject constructor(
    private val firestore: FirebaseFirestore,
    @PrintJobsCollection private val printJobsCollection: CollectionReference
) {

    companion object {
        private const val FIELD_STATUS = "status"
        private const val FIELD_CLAIMED_BY = "claimedBy"
        private const val FIELD_CLAIMED_AT = "claimedAt"
        private const val STATUS_PENDING = "pending"
        private const val STATUS_PROCESSING = "processing"
        private const val DEFAULT_MAX_RETRIES = 3
        private const val DEFAULT_RETRY_DELAY_MS = 2000L
    }

    /**
     * Atomically claims a print job using a Firestore transaction.
     *
     * The transaction reads the current document, verifies the status is still "pending",
     * then updates the status to "processing" with the claiming device's ID and timestamp.
     *
     * @param jobId The Firestore document ID of the print job to claim
     * @param deviceId The device identifier of the claiming Print Agent
     * @return [Result.Success] if the job was claimed successfully,
     *         [Result.Error] if the job is no longer pending or the transaction fails
     */
    suspend fun claimJob(jobId: String, deviceId: String): Result<Unit> {
        return try {
            val docRef = printJobsCollection.document(jobId)

            firestore.runTransaction { transaction ->
                val snapshot = transaction.get(docRef)

                if (!snapshot.exists()) {
                    throw PrintJobClaimException("Print job '$jobId' does not exist")
                }

                val currentStatus = snapshot.getString(FIELD_STATUS)
                if (currentStatus != STATUS_PENDING) {
                    throw PrintJobClaimException(
                        "Print job '$jobId' is no longer pending (status: $currentStatus)"
                    )
                }

                transaction.update(
                    docRef,
                    mapOf(
                        FIELD_STATUS to STATUS_PROCESSING,
                        FIELD_CLAIMED_BY to deviceId,
                        FIELD_CLAIMED_AT to Timestamp.now()
                    )
                )
            }.await()

            Result.Success(Unit)
        } catch (e: PrintJobClaimException) {
            Result.Error(e.message ?: "Failed to claim job", e)
        } catch (e: Exception) {
            Result.Error("Transaction failed for job '$jobId': ${e.message}", e)
        }
    }

    /**
     * Attempts to claim a print job with retry logic on transaction failure.
     *
     * Retries up to [maxRetries] times with a [delayMs] delay between attempts.
     * If all attempts fail, the job is skipped.
     *
     * @param jobId The Firestore document ID of the print job to claim
     * @param deviceId The device identifier of the claiming Print Agent
     * @param maxRetries Maximum number of claim attempts (default: 3)
     * @param delayMs Delay in milliseconds between retry attempts (default: 2000ms)
     * @return [Result.Success] if the job was claimed on any attempt,
     *         [Result.Error] if all attempts failed
     */
    suspend fun claimJobWithRetry(
        jobId: String,
        deviceId: String,
        maxRetries: Int = DEFAULT_MAX_RETRIES,
        delayMs: Long = DEFAULT_RETRY_DELAY_MS
    ): Result<Unit> {
        var lastError: Result.Error? = null

        repeat(maxRetries) { attempt ->
            val result = claimJob(jobId, deviceId)

            when (result) {
                is Result.Success -> return result
                is Result.Error -> {
                    lastError = result
                    // If the job is no longer pending (claimed by another device),
                    // don't retry — it's not a transient failure
                    if (result.throwable is PrintJobClaimException) {
                        return result
                    }
                    // Only delay if we have more retries remaining
                    if (attempt < maxRetries - 1) {
                        delay(delayMs)
                    }
                }
                is Result.Loading -> { /* Should not occur here */ }
            }
        }

        return lastError ?: Result.Error(
            "Failed to claim job '$jobId' after $maxRetries attempts"
        )
    }

    /**
     * Verifies that the specified device currently owns (has claimed) the print job.
     *
     * This check should be performed before sending the job payload to the printer,
     * ensuring another agent hasn't taken over the job.
     *
     * @param jobId The Firestore document ID of the print job
     * @param deviceId The device identifier to verify ownership against
     * @return `true` if the job's claimedBy field matches [deviceId], `false` otherwise
     */
    suspend fun verifyOwnership(jobId: String, deviceId: String): Boolean {
        return try {
            val snapshot = printJobsCollection.document(jobId).get().await()

            if (!snapshot.exists()) {
                return false
            }

            val claimedBy = snapshot.getString(FIELD_CLAIMED_BY)
            claimedBy == deviceId
        } catch (e: Exception) {
            false
        }
    }
}

/**
 * Exception indicating a print job claim was rejected due to business logic
 * (job doesn't exist or is no longer in PENDING status).
 *
 * This is distinct from transient Firestore transaction failures and
 * signals that retrying will not help.
 */
class PrintJobClaimException(
    message: String,
    cause: Throwable? = null
) : Exception(message, cause)
