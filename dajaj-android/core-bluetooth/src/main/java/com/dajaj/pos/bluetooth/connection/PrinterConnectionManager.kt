package com.dajaj.pos.bluetooth.connection

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothSocket
import com.dajaj.pos.bluetooth.model.PrinterConnectionState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Manages Bluetooth socket connections to thermal printers.
 *
 * Handles opening/closing BluetoothSocket via SPP UUID,
 * detects unexpected disconnections (IOException on read/write),
 * and triggers auto-reconnect on disconnect.
 */
@Singleton
class PrinterConnectionManager @Inject constructor(
    private val bluetoothAdapter: BluetoothAdapter?,
    private val autoReconnectManager: AutoReconnectManager
) {

    companion object {
        /** Standard SPP (Serial Port Profile) UUID for Bluetooth serial communication. */
        private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** Active Bluetooth sockets keyed by MAC address. */
    private val activeSockets = ConcurrentHashMap<String, BluetoothSocket>()

    /** Per-printer connection state flows. */
    private val connectionStates = ConcurrentHashMap<String, MutableStateFlow<PrinterConnectionState>>()

    /** Mutex to serialize connect/disconnect operations per printer. */
    private val connectionMutexes = ConcurrentHashMap<String, Mutex>()

    /**
     * Observes the connection state of a specific printer.
     *
     * @param macAddress The Bluetooth MAC address of the printer.
     * @return A [StateFlow] emitting the current [PrinterConnectionState] for the printer.
     */
    fun observeConnectionState(macAddress: String): StateFlow<PrinterConnectionState> {
        return getOrCreateStateFlow(macAddress).asStateFlow()
    }

    /**
     * Opens a BluetoothSocket connection to the printer at the given MAC address via SPP UUID.
     *
     * @param macAddress The Bluetooth MAC address to connect to (format: XX:XX:XX:XX:XX:XX).
     * @return [Result.success] if the connection was established, [Result.failure] otherwise.
     */
    @SuppressLint("MissingPermission")
    suspend fun connect(macAddress: String): Result<Unit> {
        val mutex = getOrCreateMutex(macAddress)
        return mutex.withLock {
            try {
                val adapter = bluetoothAdapter
                    ?: return@withLock Result.failure(IllegalStateException("Bluetooth not available"))

                val device = adapter.getRemoteDevice(macAddress)
                    ?: return@withLock Result.failure(IllegalStateException("Device not found: $macAddress"))

                // Close any existing socket before re-connecting
                activeSockets[macAddress]?.let { existingSocket ->
                    try {
                        existingSocket.close()
                    } catch (_: IOException) {
                        // Ignore close errors on stale socket
                    }
                }

                // Cancel discovery to avoid slowing down the connection
                adapter.cancelDiscovery()

                val socket = device.createRfcommSocketToServiceRecord(SPP_UUID)
                socket.connect()

                activeSockets[macAddress] = socket
                updateState(macAddress, PrinterConnectionState.CONNECTED)

                // Stop any active reconnection loop since we're now connected
                autoReconnectManager.stopReconnection(macAddress)

                Result.success(Unit)
            } catch (e: IOException) {
                updateState(macAddress, PrinterConnectionState.DISCONNECTED)
                Result.failure(e)
            } catch (e: SecurityException) {
                updateState(macAddress, PrinterConnectionState.DISCONNECTED)
                Result.failure(e)
            }
        }
    }

    /**
     * Closes the Bluetooth socket connection cleanly for the specified printer.
     *
     * @param macAddress The Bluetooth MAC address to disconnect from.
     */
    suspend fun disconnect(macAddress: String) {
        val mutex = getOrCreateMutex(macAddress)
        mutex.withLock {
            // Stop any auto-reconnect attempts
            autoReconnectManager.stopReconnection(macAddress)

            activeSockets.remove(macAddress)?.let { socket ->
                try {
                    socket.close()
                } catch (_: IOException) {
                    // Best-effort close
                }
            }
            updateState(macAddress, PrinterConnectionState.DISCONNECTED)
        }
    }

    /**
     * Checks if the printer at the given MAC address has an active socket connection.
     *
     * @param macAddress The Bluetooth MAC address to check.
     * @return true if the socket is connected, false otherwise.
     */
    fun isConnected(macAddress: String): Boolean {
        val socket = activeSockets[macAddress] ?: return false
        return socket.isConnected
    }

    /**
     * Called when an unexpected disconnection is detected (e.g., IOException during read/write).
     * Triggers the auto-reconnect loop for the specified printer.
     *
     * @param macAddress The Bluetooth MAC address of the printer that disconnected unexpectedly.
     */
    fun onUnexpectedDisconnect(macAddress: String) {
        // Remove the stale socket
        activeSockets.remove(macAddress)?.let { socket ->
            try {
                socket.close()
            } catch (_: IOException) {
                // Best-effort close
            }
        }

        updateState(macAddress, PrinterConnectionState.RECONNECTING)

        // Trigger auto-reconnection
        scope.launch {
            autoReconnectManager.startReconnection(macAddress) { address ->
                connect(address)
            }
        }
    }

    /**
     * Retrieves the output stream of the connected socket for sending data.
     * If an IOException occurs, it indicates an unexpected disconnection.
     *
     * @param macAddress The Bluetooth MAC address of the printer.
     * @param data The raw byte data to send to the printer.
     * @return [Result.success] if data was sent, [Result.failure] if disconnected.
     */
    fun sendData(macAddress: String, data: ByteArray): Result<Unit> {
        val socket = activeSockets[macAddress]
            ?: return Result.failure(IOException("Printer not connected: $macAddress"))

        return try {
            socket.outputStream.write(data)
            socket.outputStream.flush()
            Result.success(Unit)
        } catch (e: IOException) {
            // Unexpected disconnection detected
            onUnexpectedDisconnect(macAddress)
            Result.failure(e)
        }
    }

    private fun updateState(macAddress: String, state: PrinterConnectionState) {
        getOrCreateStateFlow(macAddress).value = state
    }

    private fun getOrCreateStateFlow(macAddress: String): MutableStateFlow<PrinterConnectionState> {
        return connectionStates.getOrPut(macAddress) {
            MutableStateFlow(PrinterConnectionState.DISCONNECTED)
        }
    }

    private fun getOrCreateMutex(macAddress: String): Mutex {
        return connectionMutexes.getOrPut(macAddress) { Mutex() }
    }
}
