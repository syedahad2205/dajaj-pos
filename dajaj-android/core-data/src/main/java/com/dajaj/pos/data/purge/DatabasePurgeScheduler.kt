package com.dajaj.pos.data.purge

import android.util.Log
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.dajaj.pos.common.Constants
import java.util.Calendar
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Schedules the [DatabasePurgeWorker] to run once per day.
 *
 * Scheduling strategy:
 * - Uses a 24-hour [PeriodicWorkRequest] with an initial delay targeting 03:00 local time.
 * - If 03:00 has already passed today, the initial run will target 03:00 tomorrow.
 * - [ExistingPeriodicWorkPolicy.KEEP] ensures that if the work is already enqueued,
 *   a duplicate is not created (idempotent scheduling on every app launch).
 *
 * This class should be called from [DajajApplication.onCreate] or equivalent app-start
 * hook to guarantee that the purge work is always registered.
 */
@Singleton
class DatabasePurgeScheduler @Inject constructor(
    private val workManager: WorkManager
) {

    companion object {
        private const val TAG = "DatabasePurgeScheduler"
    }

    /**
     * Enqueues the periodic database purge work.
     *
     * Safe to call multiple times — existing work is kept unchanged via [KEEP] policy.
     */
    fun schedule() {
        val initialDelay = calculateInitialDelayMs()

        val purgeRequest = PeriodicWorkRequestBuilder<DatabasePurgeWorker>(
            24, TimeUnit.HOURS
        )
            .setInitialDelay(initialDelay, TimeUnit.MILLISECONDS)
            .addTag(DatabasePurgeWorker.TAG)
            .build()

        workManager.enqueueUniquePeriodicWork(
            DatabasePurgeWorker.WORK_NAME,
            ExistingPeriodicWorkPolicy.KEEP,
            purgeRequest
        )

        Log.i(TAG, "Database purge scheduled (initial delay: ${initialDelay / 1000 / 60} min)")
    }

    /**
     * Calculates the milliseconds from now until the next 03:00 local time.
     *
     * If 03:00 has already passed today, targets 03:00 tomorrow.
     */
    internal fun calculateInitialDelayMs(): Long {
        val now = Calendar.getInstance()
        val target = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, Constants.PURGE_TARGET_HOUR)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }

        // If target time has already passed today, schedule for tomorrow
        if (target.before(now) || target == now) {
            target.add(Calendar.DAY_OF_MONTH, 1)
        }

        return target.timeInMillis - now.timeInMillis
    }
}
