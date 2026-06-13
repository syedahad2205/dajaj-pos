package com.dajaj.pos.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Upsert
import com.dajaj.pos.data.local.entity.PrintJobEntity
import kotlinx.coroutines.flow.Flow

/**
 * Data Access Object for the print_jobs table.
 * Manages the local print job queue for offline printing and retry logic.
 */
@Dao
interface PrintJobDao {

    /**
     * Returns all pending print jobs in chronological order.
     * Used by the Print Agent to process jobs FIFO when printer reconnects.
     */
    @Query("SELECT * FROM print_jobs WHERE status = 'pending' ORDER BY createdAt ASC")
    fun getPendingJobs(): Flow<List<PrintJobEntity>>

    /**
     * Returns the count of pending (unprocessed) print jobs.
     * Used for queue size monitoring and 500-job limit enforcement.
     */
    @Query("SELECT COUNT(*) FROM print_jobs WHERE status = 'pending'")
    suspend fun getPendingCount(): Int

    /**
     * Returns all jobs by their status.
     * Useful for monitoring processing and failed jobs.
     */
    @Query("SELECT * FROM print_jobs WHERE status = :status ORDER BY createdAt ASC")
    fun getByStatus(status: String): Flow<List<PrintJobEntity>>

    /**
     * Returns all failed jobs for potential manual retry.
     */
    @Query("SELECT * FROM print_jobs WHERE status = 'failed' ORDER BY createdAt ASC")
    fun getFailedJobs(): Flow<List<PrintJobEntity>>

    /**
     * Returns a single print job by its ID.
     */
    @Query("SELECT * FROM print_jobs WHERE id = :jobId")
    suspend fun getById(jobId: String): PrintJobEntity?

    /**
     * Inserts a print job, replacing on conflict.
     * Used when queuing new local print jobs.
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(printJob: PrintJobEntity)

    /**
     * Inserts multiple print jobs at once.
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(printJobs: List<PrintJobEntity>)

    /**
     * Upserts a print job (insert or update).
     * Used when syncing job status from Firestore.
     */
    @Upsert
    suspend fun upsert(printJob: PrintJobEntity)

    /**
     * Marks a print job as completed.
     */
    @Query("UPDATE print_jobs SET status = 'completed', completedAt = :completedAt WHERE id = :jobId")
    suspend fun markCompleted(jobId: String, completedAt: Long)

    /**
     * Marks a print job as failed with a reason.
     */
    @Query("UPDATE print_jobs SET status = 'failed', failureReason = :reason, retryCount = retryCount + 1 WHERE id = :jobId")
    suspend fun markFailed(jobId: String, reason: String)

    /**
     * Updates the status of a print job to processing and records who claimed it.
     */
    @Query("UPDATE print_jobs SET status = 'processing', claimedBy = :deviceId, claimedAt = :claimedAt WHERE id = :jobId")
    suspend fun markProcessing(jobId: String, deviceId: String, claimedAt: Long)

    /**
     * Deletes all completed print jobs to free local storage.
     */
    @Query("DELETE FROM print_jobs WHERE status = 'completed'")
    suspend fun deleteCompletedJobs()

    /**
     * Resets a failed job back to pending for manual retry.
     */
    @Query("UPDATE print_jobs SET status = 'pending', failureReason = NULL, claimedBy = NULL, claimedAt = NULL WHERE id = :jobId")
    suspend fun resetToPending(jobId: String)
}
