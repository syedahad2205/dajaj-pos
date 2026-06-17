package com.dajaj.pos.data.purge

import android.content.Context
import android.util.Log
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.dajaj.pos.common.Constants
import com.dajaj.pos.data.local.dao.OrderDao
import com.dajaj.pos.data.local.dao.PrintJobDao
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject

/**
 * WorkManager [CoroutineWorker] that purges stale completed records from Room.
 *
 * Purge policies (Requirements 18.4, 18.9):
 * - Completed orders older than 30 days are deleted.
 * - Completed print jobs older than 7 days are deleted.
 *
 * Scheduling:
 * - Executed once per day via a PeriodicWorkRequest.
 * - Initial delay targets 03:00 local time; subsequent runs repeat every 24 hours.
 * - Also triggered on app start if more than 24 hours have elapsed since last purge.
 *
 * Failure handling:
 * - On exception: logs the error and returns [Result.success()] to avoid blocking
 *   normal POS operations. The next scheduled run will retry purge automatically.
 * - Never returns [Result.retry()] or [Result.failure()] — purge is best-effort.
 */
@HiltWorker
class DatabasePurgeWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted workerParams: WorkerParameters,
    private val orderDao: OrderDao,
    private val printJobDao: PrintJobDao
) : CoroutineWorker(appContext, workerParams) {

    companion object {
        const val TAG = "DatabasePurgeWorker"
        const val WORK_NAME = "database_purge_worker"
    }

    override suspend fun doWork(): Result {
        return try {
            val now = System.currentTimeMillis()
            val orderCutoff = now - Constants.PURGE_ORDER_AGE_MS
            val printJobCutoff = now - Constants.PURGE_PRINT_JOB_AGE_MS

            val deletedOrders = orderDao.deleteCompletedBefore(orderCutoff)
            val deletedPrintJobs = printJobDao.deleteCompletedBefore(printJobCutoff)

            Log.i(
                TAG,
                "Purge completed: removed $deletedOrders orders (>30d) " +
                    "and $deletedPrintJobs print jobs (>7d)"
            )

            Result.success()
        } catch (e: Exception) {
            // Log the error but return success — purge must never block POS operations.
            // The next scheduled run (or next app launch) will retry automatically.
            Log.e(TAG, "Purge failed, will retry on next scheduled run: ${e.message}", e)
            Result.success()
        }
    }
}
