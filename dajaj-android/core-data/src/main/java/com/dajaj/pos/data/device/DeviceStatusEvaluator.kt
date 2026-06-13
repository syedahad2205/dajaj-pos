package com.dajaj.pos.data.device

import com.dajaj.pos.common.Constants
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Evaluates whether a device should be considered OFFLINE based on its last heartbeat timestamp.
 *
 * Per Requirement 10.4: a device is OFFLINE when its `lastHeartbeat` timestamp is older than
 * [Constants.DEVICE_OFFLINE_THRESHOLD_MS] (90 seconds) from the current time.
 *
 * This evaluator is used by any connected client (Android POS, Web Dashboard) that reads
 * device documents from the `devices` collection. The offline status is evaluated client-side
 * rather than server-side, so each reader determines staleness based on its own clock.
 */
@Singleton
class DeviceStatusEvaluator @Inject constructor() {

    /**
     * Determines whether a device is offline based on its last heartbeat timestamp.
     *
     * A device is considered offline if the elapsed time since its last heartbeat
     * exceeds [Constants.DEVICE_OFFLINE_THRESHOLD_MS] (90 seconds).
     *
     * @param lastHeartbeat The device's last heartbeat timestamp in epoch milliseconds.
     * @return `true` if the device is offline (heartbeat is stale), `false` if online.
     */
    fun isDeviceOffline(lastHeartbeat: Long): Boolean {
        return isDeviceOffline(lastHeartbeat, System.currentTimeMillis())
    }

    /**
     * Determines whether a device is offline based on its last heartbeat timestamp,
     * evaluated against the provided current time.
     *
     * This overload is useful for testing with a controlled clock.
     *
     * @param lastHeartbeat The device's last heartbeat timestamp in epoch milliseconds.
     * @param currentTimeMillis The current time in epoch milliseconds to evaluate against.
     * @return `true` if the device is offline (heartbeat is stale), `false` if online.
     */
    fun isDeviceOffline(lastHeartbeat: Long, currentTimeMillis: Long): Boolean {
        val elapsed = currentTimeMillis - lastHeartbeat
        return elapsed > Constants.DEVICE_OFFLINE_THRESHOLD_MS
    }

    /**
     * Returns the appropriate device status string based on the last heartbeat.
     *
     * @param lastHeartbeat The device's last heartbeat timestamp in epoch milliseconds.
     * @return [DeviceRegistrationService.STATUS_OFFLINE] if stale, [DeviceRegistrationService.STATUS_ONLINE] otherwise.
     */
    fun evaluateStatus(lastHeartbeat: Long): String {
        return if (isDeviceOffline(lastHeartbeat)) {
            DeviceRegistrationService.STATUS_OFFLINE
        } else {
            DeviceRegistrationService.STATUS_ONLINE
        }
    }

    /**
     * Returns the appropriate device status string based on the last heartbeat,
     * evaluated against the provided current time.
     *
     * @param lastHeartbeat The device's last heartbeat timestamp in epoch milliseconds.
     * @param currentTimeMillis The current time in epoch milliseconds to evaluate against.
     * @return [DeviceRegistrationService.STATUS_OFFLINE] if stale, [DeviceRegistrationService.STATUS_ONLINE] otherwise.
     */
    fun evaluateStatus(lastHeartbeat: Long, currentTimeMillis: Long): String {
        return if (isDeviceOffline(lastHeartbeat, currentTimeMillis)) {
            DeviceRegistrationService.STATUS_OFFLINE
        } else {
            DeviceRegistrationService.STATUS_ONLINE
        }
    }
}
