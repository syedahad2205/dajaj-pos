package com.dajaj.pos.data.repository

import android.util.Log
import com.dajaj.pos.common.Constants
import com.dajaj.pos.common.Result
import com.dajaj.pos.common.network.ConnectivityMonitor
import com.dajaj.pos.data.di.PrintJobsCollection
import com.dajaj.pos.data.local.dao.PrintJobDao
import com.dajaj.pos.data.local.entity.PrintJobEntity
import com.dajaj.pos.domain.model.PrintJob
import com.dajaj.pos.domain.model.PrintJobStatus
import com.dajaj.pos.domain.model.PrintJobType
import com.dajaj.pos.domain.repository.NewPrintJob
import com.dajaj.pos.domain.repository.PrintQueueRepository
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.Query
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.tasks.await
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Implementation of [PrintQueueRepository] managing Firestore-backed print queue
 * with offline fallback to Room Database.
 *
 * - Creates print jobs in Firestore; falls back to Room when offline.
 * - Observes pending jobs via Firestore real-time listener (FIFO by createdAt).
 * - Claims jobs atomically via Firestore transactions.
 * - Syncs locally queued jobs to Firestore preserving original createdAt.
 * - Enforces 500-job offline queue limit.
 *
 * Requirements: 7.1, 7.2, 7.11, 7.12
 */
@Singleton
class PrintQueueRepositoryImpl @Inject constructor(
    @PrintJobsCollection private val printJobsCollection: CollectionReference,
    private val printJobDao: PrintJobDao,
    private val connectivityMonitor: ConnectivityMonitor,
    private val firestore: FirebaseFirestore
) : PrintQueueRepository {

    companion object {
        private const val TAG = "PrintQueueRepo"
        private const val RESTAURANT_ID = "dajaj_main"

        // Firestore field names
        private const val FIELD_ID = "id"
        private const val FIELD_RESTAURANT_ID = "restaurantId"
        private const val FIELD_JOB_TYPE = "jobType"
        private const val FIELD_PRINTER_TYPE = "printerType"
        private const val FIELD_STATUS = "status"
        private const val FIELD_CLAIMED_BY = "claimedBy"
        private const val FIELD_ORDER_ID = "orderId"
        private const val FIELD_ORDER_NUMBER = "orderNumber"
        private const val FIELD_PAYLOAD = "payload"
        private const val FIELD_RETRY_COUNT = "retryCount"
        private const val FIELD_FAILURE_REASON = "failureReason"
        private const val FIELD_SOURCE = "source"
        private const val FIELD_CREATED_AT = "createdAt"
        private const val FIELD_CLAIMED_AT = "claimedAt"
        private const val FIELD_COMPLETED_AT = "completedAt"
    }

    // ─── createPrintJob ─────────────────────────────────────────────────────────

    /**
     * Creates a new print job in Firestore with status PENDING.
     * If Firestore is unreachable, stores in Room with original createdAt.
     * Enforces 500-job offline queue limit.
     */
    override suspend fun createPrintJob(job: NewPrintJob): Result<String> {
        val jobId = UUID.randomUUID().toString()
        val createdAt = System.currentTimeMillis()

        return if (connectivityMonitor.isCurrentlyConnected()) {
            createInFirestore(jobId, job, createdAt)
        } else {
            createLocally(jobId, job, createdAt)
        }
    }

    private suspend fun createInFirestore(
        jobId: String,
        job: NewPrintJob,
        createdAt: Long
    ): Result<String> {
        return try {
            val document = buildFirestoreDocument(jobId, job, createdAt)
            printJobsCollection.document(jobId).set(document).await()
            Log.d(TAG, "Print job created in Firestore: $jobId")
            Result.Success(jobId)
        } catch (e: Exception) {
            Log.w(TAG, "Firestore write failed, falling back to local: ${e.message}")
            // Firestore might have become unreachable after the connectivity check
            createLocally(jobId, job, createdAt)
        }
    }

    private suspend fun createLocally(
        jobId: String,
        job: NewPrintJob,
        createdAt: Long
    ): Result<String> {
        val currentQueueSize = printJobDao.getPendingCount()
        if (currentQueueSize >= Constants.OFFLINE_PRINT_QUEUE_MAX) {
            Log.w(TAG, "Offline queue full ($currentQueueSize/${Constants.OFFLINE_PRINT_QUEUE_MAX})")
            return Result.Error("Print queue capacity exceeded (max ${Constants.OFFLINE_PRINT_QUEUE_MAX} jobs)")
        }

        val entity = PrintJobEntity(
            id = jobId,
            restaurantId = RESTAURANT_ID,
            jobType = job.jobType.toFirestoreValue(),
            printerType = job.printerType,
            status = PrintJobStatus.PENDING.toFirestoreValue(),
            claimedBy = null,
            orderId = job.orderId,
            orderNumber = job.orderNumber,
            payloadJson = mapToJson(job.payload),
            retryCount = 0,
            failureReason = null,
            source = job.source.toFirestoreValue(),
            createdAt = createdAt,
            claimedAt = null,
            completedAt = null
        )

        printJobDao.insert(entity)
        Log.d(TAG, "Print job stored locally (offline): $jobId")
        return Result.Success(jobId)
    }

    // ─── observePendingJobs ─────────────────────────────────────────────────────

    /**
     * Real-time listener on print_jobs where status=PENDING and restaurantId matches,
     * sorted by createdAt ASC (FIFO).
     */
    override fun observePendingJobs(): Flow<List<PrintJob>> = callbackFlow {
        var registration: ListenerRegistration? = null

        registration = printJobsCollection
            .whereEqualTo(FIELD_RESTAURANT_ID, RESTAURANT_ID)
            .whereEqualTo(FIELD_STATUS, PrintJobStatus.PENDING.toFirestoreValue())
            .orderBy(FIELD_CREATED_AT, Query.Direction.ASCENDING)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    Log.e(TAG, "Firestore listener error: ${error.message}")
                    // Don't close, attempt to keep the listener alive
                    return@addSnapshotListener
                }

                val jobs = snapshot?.documents?.mapNotNull { doc ->
                    mapDocumentToPrintJob(doc.data, doc.id)
                } ?: emptyList()

                trySend(jobs)
            }

        awaitClose {
            registration?.remove()
            Log.d(TAG, "Pending jobs listener removed")
        }
    }

    // ─── claimJob ───────────────────────────────────────────────────────────────

    /**
     * Firestore transaction: set status=PROCESSING, claimedBy=deviceId, claimedAt.
     * Fails if the job is no longer PENDING (already claimed by another device).
     */
    override suspend fun claimJob(jobId: String, deviceId: String): Result<Unit> {
        return try {
            val docRef = printJobsCollection.document(jobId)

            firestore.runTransaction { transaction ->
                val snapshot = transaction.get(docRef)

                if (!snapshot.exists()) {
                    throw IllegalStateException("Print job $jobId does not exist")
                }

                val currentStatus = snapshot.getString(FIELD_STATUS)
                if (currentStatus != PrintJobStatus.PENDING.toFirestoreValue()) {
                    throw IllegalStateException(
                        "Print job $jobId cannot be claimed: current status is $currentStatus"
                    )
                }

                val now = System.currentTimeMillis()
                transaction.update(
                    docRef,
                    mapOf(
                        FIELD_STATUS to PrintJobStatus.PROCESSING.toFirestoreValue(),
                        FIELD_CLAIMED_BY to deviceId,
                        FIELD_CLAIMED_AT to now
                    )
                )
            }.await()

            Log.d(TAG, "Job $jobId claimed by device $deviceId")
            Result.Success(Unit)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to claim job $jobId: ${e.message}")
            Result.Error(e.message ?: "Failed to claim job", e)
        }
    }

    // ─── completeJob ────────────────────────────────────────────────────────────

    /**
     * Set status=COMPLETED, set completedAt.
     */
    override suspend fun completeJob(jobId: String): Result<Unit> {
        return try {
            val now = System.currentTimeMillis()
            printJobsCollection.document(jobId)
                .update(
                    mapOf(
                        FIELD_STATUS to PrintJobStatus.COMPLETED.toFirestoreValue(),
                        FIELD_COMPLETED_AT to now
                    )
                )
                .await()

            Log.d(TAG, "Job $jobId marked as completed")
            Result.Success(Unit)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to complete job $jobId: ${e.message}")
            Result.Error(e.message ?: "Failed to complete job", e)
        }
    }

    // ─── failJob ────────────────────────────────────────────────────────────────

    /**
     * Set status=FAILED, set failureReason.
     */
    override suspend fun failJob(jobId: String, reason: String): Result<Unit> {
        return try {
            printJobsCollection.document(jobId)
                .update(
                    mapOf(
                        FIELD_STATUS to PrintJobStatus.FAILED.toFirestoreValue(),
                        FIELD_FAILURE_REASON to reason
                    )
                )
                .await()

            Log.d(TAG, "Job $jobId marked as failed: $reason")
            Result.Success(Unit)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to mark job $jobId as failed: ${e.message}")
            Result.Error(e.message ?: "Failed to mark job as failed", e)
        }
    }

    // ─── retryJob ───────────────────────────────────────────────────────────────

    /**
     * Reset status to PENDING, clear claimedBy/failureReason/claimedAt/completedAt,
     * reset retryCount=0.
     */
    override suspend fun retryJob(jobId: String): Result<Unit> {
        return try {
            printJobsCollection.document(jobId)
                .update(
                    mapOf(
                        FIELD_STATUS to PrintJobStatus.PENDING.toFirestoreValue(),
                        FIELD_CLAIMED_BY to null,
                        FIELD_FAILURE_REASON to null,
                        FIELD_CLAIMED_AT to null,
                        FIELD_COMPLETED_AT to null,
                        FIELD_RETRY_COUNT to 0
                    )
                )
                .await()

            Log.d(TAG, "Job $jobId reset to PENDING for retry")
            Result.Success(Unit)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to retry job $jobId: ${e.message}")
            Result.Error(e.message ?: "Failed to retry job", e)
        }
    }

    // ─── getLocalQueuedJobs ─────────────────────────────────────────────────────

    /**
     * Query Room for unsynced (pending) print jobs in FIFO order.
     */
    override suspend fun getLocalQueuedJobs(): List<PrintJob> {
        val entities = printJobDao.getPendingJobs().first()
        return entities.map { entity -> mapEntityToPrintJob(entity) }
    }

    // ─── syncLocalJobs ──────────────────────────────────────────────────────────

    /**
     * Push Room-stored jobs to Firestore in chronological order,
     * preserving original createdAt timestamps.
     */
    override suspend fun syncLocalJobs(): Result<Unit> {
        if (!connectivityMonitor.isCurrentlyConnected()) {
            return Result.Error("No internet connectivity for sync")
        }

        val localJobs = printJobDao.getPendingJobs().first()
        if (localJobs.isEmpty()) {
            Log.d(TAG, "No local jobs to sync")
            return Result.Success(Unit)
        }

        Log.d(TAG, "Syncing ${localJobs.size} local jobs to Firestore")
        var failedCount = 0

        for (entity in localJobs) {
            try {
                val document = buildFirestoreDocumentFromEntity(entity)
                printJobsCollection.document(entity.id).set(document).await()

                // Remove from local queue after successful sync
                printJobDao.markCompleted(entity.id, System.currentTimeMillis())
                Log.d(TAG, "Synced local job ${entity.id} to Firestore")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to sync job ${entity.id}: ${e.message}")
                failedCount++
                // Continue syncing remaining jobs
            }
        }

        return if (failedCount == 0) {
            Log.d(TAG, "All local jobs synced successfully")
            Result.Success(Unit)
        } else {
            Result.Error("Failed to sync $failedCount out of ${localJobs.size} jobs")
        }
    }

    // ─── Private helpers ────────────────────────────────────────────────────────

    private fun buildFirestoreDocument(
        jobId: String,
        job: NewPrintJob,
        createdAt: Long
    ): Map<String, Any?> {
        return mapOf(
            FIELD_ID to jobId,
            FIELD_RESTAURANT_ID to RESTAURANT_ID,
            FIELD_JOB_TYPE to job.jobType.toFirestoreValue(),
            FIELD_PRINTER_TYPE to job.printerType,
            FIELD_STATUS to PrintJobStatus.PENDING.toFirestoreValue(),
            FIELD_CLAIMED_BY to null,
            FIELD_ORDER_ID to job.orderId,
            FIELD_ORDER_NUMBER to job.orderNumber,
            FIELD_PAYLOAD to job.payload,
            FIELD_RETRY_COUNT to 0,
            FIELD_FAILURE_REASON to null,
            FIELD_SOURCE to job.source.toFirestoreValue(),
            FIELD_CREATED_AT to createdAt,
            FIELD_CLAIMED_AT to null,
            FIELD_COMPLETED_AT to null
        )
    }

    private fun buildFirestoreDocumentFromEntity(entity: PrintJobEntity): Map<String, Any?> {
        return mapOf(
            FIELD_ID to entity.id,
            FIELD_RESTAURANT_ID to entity.restaurantId,
            FIELD_JOB_TYPE to entity.jobType,
            FIELD_PRINTER_TYPE to entity.printerType,
            FIELD_STATUS to PrintJobStatus.PENDING.toFirestoreValue(),
            FIELD_CLAIMED_BY to null,
            FIELD_ORDER_ID to entity.orderId,
            FIELD_ORDER_NUMBER to entity.orderNumber,
            FIELD_PAYLOAD to jsonToMap(entity.payloadJson),
            FIELD_RETRY_COUNT to 0,
            FIELD_FAILURE_REASON to null,
            FIELD_SOURCE to entity.source,
            FIELD_CREATED_AT to entity.createdAt, // Preserves original createdAt
            FIELD_CLAIMED_AT to null,
            FIELD_COMPLETED_AT to null
        )
    }

    @Suppress("UNCHECKED_CAST")
    private fun mapDocumentToPrintJob(data: Map<String, Any>?, docId: String): PrintJob? {
        if (data == null) return null

        return try {
            PrintJob(
                id = data[FIELD_ID] as? String ?: docId,
                restaurantId = data[FIELD_RESTAURANT_ID] as? String ?: return null,
                jobType = PrintJobType.fromString(data[FIELD_JOB_TYPE] as? String ?: "kot"),
                printerType = data[FIELD_PRINTER_TYPE] as? String ?: "bill",
                status = PrintJobStatus.fromString(data[FIELD_STATUS] as? String ?: "pending"),
                claimedBy = data[FIELD_CLAIMED_BY] as? String,
                orderId = data[FIELD_ORDER_ID] as? String ?: "",
                orderNumber = data[FIELD_ORDER_NUMBER] as? String ?: "",
                payload = (data[FIELD_PAYLOAD] as? Map<String, Any>) ?: emptyMap(),
                retryCount = (data[FIELD_RETRY_COUNT] as? Number)?.toInt() ?: 0,
                failureReason = data[FIELD_FAILURE_REASON] as? String,
                source = data[FIELD_SOURCE] as? String ?: "android_pos",
                createdAt = (data[FIELD_CREATED_AT] as? Number)?.toLong() ?: 0L,
                claimedAt = (data[FIELD_CLAIMED_AT] as? Number)?.toLong(),
                completedAt = (data[FIELD_COMPLETED_AT] as? Number)?.toLong()
            )
        } catch (e: Exception) {
            Log.e(TAG, "Failed to map document $docId: ${e.message}")
            null
        }
    }

    private fun mapEntityToPrintJob(entity: PrintJobEntity): PrintJob {
        return PrintJob(
            id = entity.id,
            restaurantId = entity.restaurantId,
            jobType = PrintJobType.fromString(entity.jobType),
            printerType = entity.printerType,
            status = PrintJobStatus.fromString(entity.status),
            claimedBy = entity.claimedBy,
            orderId = entity.orderId ?: "",
            orderNumber = entity.orderNumber ?: "",
            payload = jsonToMap(entity.payloadJson),
            retryCount = entity.retryCount,
            failureReason = entity.failureReason,
            source = entity.source ?: "android_pos",
            createdAt = entity.createdAt,
            claimedAt = entity.claimedAt,
            completedAt = entity.completedAt
        )
    }

    /**
     * Simple JSON serialization for payload map.
     * Uses org.json for lightweight serialization without additional dependencies.
     */
    private fun mapToJson(map: Map<String, Any>): String {
        return try {
            org.json.JSONObject(map).toString()
        } catch (e: Exception) {
            "{}"
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun jsonToMap(json: String): Map<String, Any> {
        return try {
            val jsonObject = org.json.JSONObject(json)
            val map = mutableMapOf<String, Any>()
            jsonObject.keys().forEach { key ->
                jsonObject.get(key)?.let { value ->
                    map[key] = value
                }
            }
            map
        } catch (e: Exception) {
            emptyMap()
        }
    }
}
