package com.dajaj.pos.data.device

import android.util.Log
import com.dajaj.pos.common.Constants
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Heartbeat worker that runs as a coroutine loop inside the Print Agent Foreground Service.
 *
 * WorkManager's minimum periodic interval is 15 minutes, which is far too infrequent for
 * the 30-second heartbeat requirement (Requirement 10.3). Instead, this class launches a
 * coroutine loop that updates the device's `lastHeartbeat` field in Firestore every
 * [Constants.HEARTBEAT_INTERVAL_MS] (30 seconds).
 *
 * The loop is started when the foreground service starts and cancelled when it stops,
 * ensuring continuous heartbeat updates while the POS is operational.
 *
 * Usage:
 * ```kotlin
 * // In PrintAgentService.onStartCommand():
 * heartbeatWorker.start(lifecycleScope)
 *
 * // In PrintAgentService.onDestroy():
 * heartbeatWorker.stop()
 * ```
 */
@Singleton
class HeartbeatWorker @Inject constructor(
    private val deviceRegistrationService: DeviceRegistrationService
) {

    companion object {
        private const val TAG = "HeartbeatWorker"
    }

    private var heartbeatJob: Job? = null

    /**
     * Whether the heartbeat loop is currently active.
     */
    val isRunning: Boolean
        get() = heartbeatJob?.isActive == true

    /**
     * Starts the heartbeat coroutine loop in the given [scope].
     *
     * The loop updates the device's `lastHeartbeat` in Firestore every 30 seconds.
     * If an update fails, the loop continues on the next interval — transient errors
     * do not stop the heartbeat.
     *
     * If a heartbeat loop is already running, this method cancels it first and restarts.
     *
     * @param scope The [CoroutineScope] to launch the heartbeat loop in.
     *              Typically the service's `lifecycleScope`.
     */
    fun start(scope: CoroutineScope) {
        // Cancel any existing heartbeat loop before starting a new one
        stop()

        heartbeatJob = scope.launch {
            Log.d(TAG, "Heartbeat loop started (interval: ${Constants.HEARTBEAT_INTERVAL_MS}ms)")

            while (isActive) {
                try {
                    val success = deviceRegistrationService.updateHeartbeat()
                    if (!success) {
                        Log.w(TAG, "Heartbeat update returned false, will retry next interval")
                    }
                } catch (e: CancellationException) {
                    throw e // Propagate cancellation
                } catch (e: Exception) {
                    Log.e(TAG, "Heartbeat update failed: ${e.message}", e)
                    // Continue loop — transient errors should not stop heartbeats
                }

                delay(Constants.HEARTBEAT_INTERVAL_MS)
            }
        }
    }

    /**
     * Stops the heartbeat coroutine loop.
     *
     * Should be called when the foreground service is being destroyed to
     * cleanly terminate the loop.
     */
    fun stop() {
        heartbeatJob?.cancel()
        heartbeatJob = null
        Log.d(TAG, "Heartbeat loop stopped")
    }
}
