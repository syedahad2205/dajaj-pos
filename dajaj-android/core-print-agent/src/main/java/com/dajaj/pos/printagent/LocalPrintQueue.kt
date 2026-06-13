package com.dajaj.pos.printagent

import android.util.Log
import com.dajaj.pos.bluetooth.PrinterManager
import com.dajaj.pos.bluetooth.model.PrinterConnectionState
import com.dajaj.pos.common.Constants
import com.dajaj.pos.common.network.ConnectivityMonitor
import com.dajaj.pos.common.network.ConnectivityState
import com.dajaj.pos.data.di.PrintJobsCollection
import com.dajaj.pos.data.local.dao.PrintJobDao
import com.dajaj.pos.data.local.entity.PrintJobEntity
import com.google.firebase.firestore.CollectionReference
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Local print queue that stores print jobs in Room when the Bluetooth printer
 * is disconnected. Automatically drains the queue in FIFO order when the printer
 * reconnects. Syncs job statuses to Firestore when internet connectivity is restored.
 *
 * Queue capacity: [Constants.OFFLINE_PRINT_QUEUE_MAX] (500 jobs).
 * Retry policy: Each job retried up to [Constants.PRINT_RETRY_MAX] (3) times during drain.
 */
@Singleton
class LocalPrintQueue @Inject constructor(
    private val printJobDao: PrintJobDao,
    private val printerManager: PrinterManager,
    private val connectivityMonitor: ConnectivityMonitor,
    @PrintJobsCollection private val printJobsCollection: CollectionReference
) {

    private var printerObserverJob: Job? = null
    private var connectivityObserverJob: Job? = null
    private var isDraining = false

    companion object {
        private const val TAG = "LocalPrintQueue"
    }

    // ─── Public API ─────────────────────────────────────────────────────────────

    /**
     * Adds a print job to the local queue in Room.
     * Enforces the [Constants.OFFLINE_PRINT_QUEUE_MAX] limit (500 jobs).
     *
     * @param printJob The print job entity to enqueue.
     * @return [Result.success] if enqueued, [Result.failure] if queue is full.
     */
    suspend fun enqueue(printJob: PrintJobEntity): Result<Unit> {
        val currentSize = printJobDao.getPendingCount()
        if (currentSize >= Constants.OFFLINE_PRINT_QUEUE_MAX) {
            Log.w(TAG, "Queue full ($currentSize/${Constants.OFFLINE_PRINT_QUEUE_MAX}). Rejecting job: ${printJob.id}")
            return Result.failure(
                IllegalStateException("Print queue is full (max ${Constants.OFFLINE_PRINT_QUEUE_MAX} jobs)")
            )
        }

        val pendingJob = printJob.copy(status = "pending", claimedBy = null, claimedAt = null)
        printJobDao.insert(pendingJob)
        Log.d(TAG, "Enqueued print job: ${printJob.id} (queue size: ${currentSize + 1})")
        return Result.success(Unit)
    }

    /**
     * Drains all pending jobs from the local queue in FIFO order.
     * For each job:
     * - Attempts to print via the [onPrint] callback.
     * - On failure: retries up to [Constants.PRINT_RETRY_MAX] times, then marks the job as failed.
     * - On success: marks the job as completed locally.
     *
     * @param onPrint Callback that executes the actual print operation for a job.
     */
    suspend fun drainQueue(onPrint: suspend (PrintJobEntity) -> Result<Unit>) {
        if (isDraining) {
            Log.d(TAG, "Drain already in progress, skipping")
            return
        }

        isDraining = true
        try {
            val pendingJobs = printJobDao.getPendingJobs().first()
            Log.d(TAG, "Draining queue: ${pendingJobs.size} pending jobs")

            for (job in pendingJobs) {
                var success = false

                for (attempt in 1..Constants.PRINT_RETRY_MAX) {
                    val result = onPrint(job)
                    if (result.isSuccess) {
                        printJobDao.markCompleted(job.id, System.currentTimeMillis())
                        Log.d(TAG, "Job ${job.id} completed on attempt $attempt")
                        success = true
                        break
                    } else {
                        val error = result.exceptionOrNull()?.message ?: "Unknown error"
                        Log.w(TAG, "Job ${job.id} failed attempt $attempt/${ Constants.PRINT_RETRY_MAX}: $error")

                        if (attempt < Constants.PRINT_RETRY_MAX) {
                            // Exponential backoff between retries
                            val backoffDelay = Constants.PRINT_RETRY_BASE_DELAY_MS * (1L shl (attempt - 1))
                            delay(backoffDelay)
                        }
                    }
                }

                if (!success) {
                    printJobDao.markFailed(job.id, "Exhausted ${Constants.PRINT_RETRY_MAX} retry attempts")
                    Log.w(TAG, "Job ${job.id} permanently failed after ${Constants.PRINT_RETRY_MAX} attempts, skipping")
                }
            }

            Log.d(TAG, "Queue drain complete")
        } finally {
            isDraining = false
        }
    }

    /**
     * Returns the current number of pending print jobs in the queue.
     */
    suspend fun getQueueSize(): Int {
        return printJobDao.getPendingCount()
    }

    /**
     * Syncs completed and failed job statuses to Firestore when internet restores.
     * Reads locally completed/failed jobs and writes their status to the Firestore
     * print_jobs collection.
     */
    suspend fun syncToFirestore() {
        if (!connectivityMonitor.isCurrentlyConnected()) {
            Log.d(TAG, "No internet connectivity, skipping Firestore sync")
            return
        }

        val completedJobs = printJobDao.getByStatus("completed").first()
        val failedJobs = printJobDao.getByStatus("failed").first()

        val jobsToSync = completedJobs + failedJobs
        if (jobsToSync.isEmpty()) {
            Log.d(TAG, "No jobs to sync to Firestore")
            return
        }

        Log.d(TAG, "Syncing ${jobsToSync.size} jobs to Firestore")

        for (job in jobsToSync) {
            try {
                val updates = mutableMapOf<String, Any?>(
                    "status" to job.status,
                    "retryCount" to job.retryCount
                )

                if (job.completedAt != null) {
                    updates["completedAt"] = job.completedAt
                }
                if (job.failureReason != null) {
                    updates["failureReason"] = job.failureReason
                }

                printJobsCollection.document(job.id)
                    .update(updates)
                    .await()

                Log.d(TAG, "Synced job ${job.id} (status: ${job.status}) to Firestore")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to sync job ${job.id} to Firestore: ${e.message}")
                // Continue syncing other jobs even if one fails
            }
        }

        // Clean up completed jobs from local storage after successful sync
        printJobDao.deleteCompletedJobs()
        Log.d(TAG, "Firestore sync complete, cleaned up completed jobs")
    }

    // ─── Observers ──────────────────────────────────────────────────────────────

    /**
     * Starts observing printer connection state and internet connectivity.
     * - Auto-triggers [drainQueue] when the printer reconnects.
     * - Auto-triggers [syncToFirestore] when internet connectivity is restored.
     *
     * @param scope CoroutineScope to launch observer coroutines in.
     * @param onPrint Callback for printing during auto-drain.
     */
    fun startObserving(scope: CoroutineScope, onPrint: suspend (PrintJobEntity) -> Result<Unit>) {
        observePrinterConnection(scope, onPrint)
        observeConnectivity(scope)
    }

    /**
     * Stops observing printer connection state and connectivity changes.
     */
    fun stopObserving() {
        printerObserverJob?.cancel()
        printerObserverJob = null
        connectivityObserverJob?.cancel()
        connectivityObserverJob = null
    }

    /**
     * Observes printer connection state. When the printer transitions from
     * DISCONNECTED/RECONNECTING to CONNECTED, triggers queue drain.
     */
    private fun observePrinterConnection(
        scope: CoroutineScope,
        onPrint: suspend (PrintJobEntity) -> Result<Unit>
    ) {
        printerObserverJob?.cancel()
        printerObserverJob = scope.launch {
            var previousState = PrinterConnectionState.DISCONNECTED

            printerManager.observeConnectionState()
                .distinctUntilChanged()
                .collect { state ->
                    if (state == PrinterConnectionState.CONNECTED &&
                        previousState != PrinterConnectionState.CONNECTED
                    ) {
                        Log.d(TAG, "Printer reconnected, triggering queue drain")
                        drainQueue(onPrint)
                    }
                    previousState = state
                }
        }
    }

    /**
     * Observes internet connectivity state. When connectivity transitions from
     * OFFLINE to ONLINE, triggers Firestore sync.
     */
    private fun observeConnectivity(scope: CoroutineScope) {
        connectivityObserverJob?.cancel()
        connectivityObserverJob = scope.launch {
            var previousState = ConnectivityState.OFFLINE

            connectivityMonitor.connectivityState
                .distinctUntilChanged()
                .collect { state ->
                    if (state == ConnectivityState.ONLINE &&
                        previousState == ConnectivityState.OFFLINE
                    ) {
                        Log.d(TAG, "Internet restored, syncing to Firestore")
                        syncToFirestore()
                    }
                    previousState = state
                }
        }
    }
}
