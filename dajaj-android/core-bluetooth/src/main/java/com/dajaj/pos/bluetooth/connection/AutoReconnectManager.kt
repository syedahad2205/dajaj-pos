package com.dajaj.pos.bluetooth.connection

import com.dajaj.pos.bluetooth.model.PrinterConnectionState
import com.dajaj.pos.common.Constants
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Manages auto-reconnection loops for Bluetooth thermal printers.
 *
 * On unexpected disconnection, attempts to reconnect at [Constants.PRINTER_RECONNECT_INTERVAL_MS]
 * intervals for up to [Constants.PRINTER_RECONNECT_TIMEOUT_MS]. Each printer has an independent
 * reconnection loop using coroutines with delay().
 *
 * Exposes per-printer reconnection state as [StateFlow]<[PrinterConnectionState]>.
 */
@Singleton
class AutoReconnectManager @Inject constructor() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** Active reconnection jobs keyed by MAC address. */
    private val reconnectJobs = ConcurrentHashMap<String, Job>()

    /** Per-printer reconnection state flows. */
    private val reconnectStates = ConcurrentHashMap<String, MutableStateFlow<PrinterConnectionState>>()

    /** Callbacks for notification when reconnection times out. */
    private val timeoutListeners = ConcurrentHashMap<String, (() -> Unit)>()

    /**
     * Observes the reconnection state for a specific printer.
     *
     * @param macAddress The Bluetooth MAC address of the printer.
     * @return A [StateFlow] emitting the current [PrinterConnectionState].
     */
    fun observeReconnectionState(macAddress: String): StateFlow<PrinterConnectionState> {
        return getOrCreateStateFlow(macAddress).asStateFlow()
    }

    /**
     * Registers a listener that is invoked when auto-reconnection times out for a printer.
     * This can be used to trigger a system notification about the unreachable printer.
     *
     * @param macAddress The Bluetooth MAC address of the printer.
     * @param listener The callback to invoke on timeout.
     */
    fun setTimeoutListener(macAddress: String, listener: () -> Unit) {
        timeoutListeners[macAddress] = listener
    }

    /**
     * Begins the auto-reconnection loop for the specified printer.
     *
     * Attempts reconnect every [Constants.PRINTER_RECONNECT_INTERVAL_MS] (5 seconds).
     * Total timeout: [Constants.PRINTER_RECONNECT_TIMEOUT_MS] (60 seconds).
     *
     * - On success: emits [PrinterConnectionState.CONNECTED], stops loop.
     * - On timeout: emits [PrinterConnectionState.DISCONNECTED], stops loop,
     *   invokes the registered timeout listener (for notification).
     *
     * Supports concurrent reconnection for multiple printers independently.
     * If a reconnection loop is already active for the given printer, this call is a no-op.
     *
     * @param macAddress The Bluetooth MAC address to reconnect.
     * @param connectAction A suspend function that attempts the actual connection,
     *                      returning [Result.success] on success.
     */
    suspend fun startReconnection(
        macAddress: String,
        connectAction: suspend (String) -> Result<Unit>
    ) {
        // If a reconnection loop is already running for this printer, do nothing
        if (reconnectJobs[macAddress]?.isActive == true) {
            return
        }

        val stateFlow = getOrCreateStateFlow(macAddress)
        stateFlow.value = PrinterConnectionState.RECONNECTING

        val job = scope.launch {
            val startTime = System.currentTimeMillis()
            val timeout = Constants.PRINTER_RECONNECT_TIMEOUT_MS
            val interval = Constants.PRINTER_RECONNECT_INTERVAL_MS

            while (true) {
                val elapsed = System.currentTimeMillis() - startTime

                // Check if we've exceeded the timeout
                if (elapsed >= timeout) {
                    // Timeout reached — stop attempts, set disconnected
                    stateFlow.value = PrinterConnectionState.DISCONNECTED
                    timeoutListeners[macAddress]?.invoke()
                    break
                }

                // Attempt reconnection
                val result = try {
                    connectAction(macAddress)
                } catch (e: CancellationException) {
                    throw e // Don't swallow coroutine cancellation
                } catch (_: Exception) {
                    Result.failure(Exception("Connection attempt failed"))
                }

                if (result.isSuccess) {
                    // Reconnection succeeded
                    stateFlow.value = PrinterConnectionState.CONNECTED
                    break
                }

                // Wait before the next attempt
                delay(interval)
            }
        }

        reconnectJobs[macAddress] = job
    }

    /**
     * Stops any active reconnection loop for the specified printer.
     *
     * @param macAddress The Bluetooth MAC address to stop reconnecting.
     */
    fun stopReconnection(macAddress: String) {
        reconnectJobs.remove(macAddress)?.cancel()
    }

    /**
     * Checks if a reconnection loop is currently active for the specified printer.
     *
     * @param macAddress The Bluetooth MAC address to check.
     * @return true if a reconnection loop is running, false otherwise.
     */
    fun isReconnecting(macAddress: String): Boolean {
        return reconnectJobs[macAddress]?.isActive == true
    }

    private fun getOrCreateStateFlow(macAddress: String): MutableStateFlow<PrinterConnectionState> {
        return reconnectStates.getOrPut(macAddress) {
            MutableStateFlow(PrinterConnectionState.DISCONNECTED)
        }
    }
}
