package com.dajaj.pos.bluetooth

import android.bluetooth.BluetoothAdapter
import com.dajaj.pos.bluetooth.model.BluetoothDeviceInfo
import com.dajaj.pos.bluetooth.model.PrinterConnectionState
import com.dajaj.pos.bluetooth.model.PrinterInfo
import com.dajaj.pos.bluetooth.model.PrinterRole
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Default implementation of [PrinterManager].
 *
 * Manages a map of connected printers and delegates to [BluetoothAdapter] for
 * low-level Bluetooth operations. Exposes StateFlows for connection state and
 * paired printers so that the UI layer can observe changes reactively.
 *
 * NOTE: The actual Bluetooth socket I/O, scanning, and reconnection logic
 * will be implemented in subsequent tasks (11.2 / 11.3).
 */
@Singleton
class PrinterManagerImpl @Inject constructor(
    private val bluetoothAdapter: BluetoothAdapter?
) : PrinterManager {

    /** Current overall connection state of the printer subsystem. */
    private val _connectionState = MutableStateFlow(PrinterConnectionState.DISCONNECTED)

    /** List of paired printers with their current status and role assignments. */
    private val _pairedPrinters = MutableStateFlow<List<PrinterInfo>>(emptyList())

    /** Map of MAC address → connected printer info for quick lookup. */
    private val connectedPrinters = mutableMapOf<String, PrinterInfo>()

    // ─── Observable Streams ─────────────────────────────────────────────────────

    override fun observeConnectionState(): Flow<PrinterConnectionState> {
        return _connectionState.asStateFlow()
    }

    override fun observePairedPrinters(): Flow<List<PrinterInfo>> {
        return _pairedPrinters.asStateFlow()
    }

    // ─── Device Discovery ───────────────────────────────────────────────────────

    override suspend fun scanForDevices(): Result<List<BluetoothDeviceInfo>> {
        if (bluetoothAdapter == null) {
            return Result.failure(IllegalStateException("Bluetooth is not available on this device"))
        }
        if (!bluetoothAdapter.isEnabled) {
            return Result.failure(IllegalStateException("Bluetooth is disabled"))
        }

        _connectionState.value = PrinterConnectionState.SCANNING

        // TODO: Implement actual Bluetooth discovery in task 11.2
        // Will use BluetoothAdapter.startDiscovery() with a BroadcastReceiver
        // and a timeout of BLUETOOTH_SCAN_TIMEOUT_MS (15s).

        _connectionState.value = PrinterConnectionState.DISCONNECTED
        return Result.success(emptyList())
    }

    // ─── Pairing ────────────────────────────────────────────────────────────────

    override suspend fun pairDevice(macAddress: String): Result<Unit> {
        if (bluetoothAdapter == null) {
            return Result.failure(IllegalStateException("Bluetooth is not available on this device"))
        }

        // TODO: Implement Bluetooth pairing in task 11.2
        // Will use BluetoothDevice.createBond() and listen for BOND_STATE_CHANGED.
        return Result.failure(UnsupportedOperationException("Pairing not yet implemented"))
    }

    // ─── Connection Management ──────────────────────────────────────────────────

    override suspend fun connect(macAddress: String): Result<Unit> {
        if (bluetoothAdapter == null) {
            return Result.failure(IllegalStateException("Bluetooth is not available on this device"))
        }

        // TODO: Implement Bluetooth socket connection in task 11.3
        // Will open an RFCOMM socket to the printer and update connectedPrinters map.
        return Result.failure(UnsupportedOperationException("Connection not yet implemented"))
    }

    override suspend fun disconnect(macAddress: String): Result<Unit> {
        // TODO: Implement disconnect in task 11.3
        // Will close the socket and remove from connectedPrinters map.
        return Result.failure(UnsupportedOperationException("Disconnect not yet implemented"))
    }

    // ─── Printing ───────────────────────────────────────────────────────────────

    override suspend fun testPrint(macAddress: String): Result<Unit> {
        if (!isConnected(macAddress)) {
            return Result.failure(IllegalStateException("Printer is not connected"))
        }

        // TODO: Implement test print in task 11.3
        // Will send a simple ESC/POS test page.
        return Result.failure(UnsupportedOperationException("Test print not yet implemented"))
    }

    override suspend fun printData(macAddress: String, data: ByteArray): Result<Unit> {
        if (!isConnected(macAddress)) {
            return Result.failure(IllegalStateException("Printer is not connected"))
        }

        // TODO: Implement data printing in task 11.3
        // Will write raw bytes to the Bluetooth socket output stream.
        return Result.failure(UnsupportedOperationException("Print data not yet implemented"))
    }

    // ─── Status Queries ─────────────────────────────────────────────────────────

    override fun isConnected(macAddress: String): Boolean {
        return connectedPrinters.containsKey(macAddress)
    }

    override fun getConnectedPrinter(role: PrinterRole): PrinterInfo? {
        return connectedPrinters.values.firstOrNull { it.role == role && it.isConnected }
    }

    // ─── Internal Helpers ───────────────────────────────────────────────────────

    /**
     * Updates the overall connection state based on the current connected printers.
     */
    private fun updateConnectionState() {
        _connectionState.value = when {
            connectedPrinters.isNotEmpty() -> PrinterConnectionState.CONNECTED
            else -> PrinterConnectionState.DISCONNECTED
        }
    }

    /**
     * Adds a printer to the connected map and notifies observers.
     */
    internal fun onPrinterConnected(printer: PrinterInfo) {
        connectedPrinters[printer.macAddress] = printer
        updateConnectionState()
        refreshPairedPrintersList()
    }

    /**
     * Removes a printer from the connected map and notifies observers.
     */
    internal fun onPrinterDisconnected(macAddress: String) {
        connectedPrinters.remove(macAddress)
        updateConnectionState()
        refreshPairedPrintersList()
    }

    /**
     * Refreshes the paired printers state flow with the latest data.
     */
    private fun refreshPairedPrintersList() {
        _pairedPrinters.value = connectedPrinters.values.toList()
    }
}
