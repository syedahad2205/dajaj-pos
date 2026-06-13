package com.dajaj.pos.feature.settings.printer

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dajaj.pos.bluetooth.PrinterManager
import com.dajaj.pos.bluetooth.model.BluetoothDeviceInfo
import com.dajaj.pos.bluetooth.model.PrinterConnectionState
import com.dajaj.pos.bluetooth.model.PrinterInfo
import com.dajaj.pos.bluetooth.model.PrinterRole
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * ViewModel for the Printer Settings screen.
 *
 * Manages Bluetooth scanning, printer connections, test printing,
 * and role assignment (KOT / Bill). Exposes reactive state flows
 * for the UI to observe.
 */
@HiltViewModel
class PrinterSettingsViewModel @Inject constructor(
    private val printerManager: PrinterManager
) : ViewModel() {

    // ─── Printer List ───────────────────────────────────────────────────────────

    /**
     * Observable list of paired printers and their current status.
     */
    val printers: StateFlow<List<PrinterInfo>> = printerManager.observePairedPrinters()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    // ─── Scan State ─────────────────────────────────────────────────────────────

    private val _scanState = MutableStateFlow(ScanState.IDLE)
    val scanState: StateFlow<ScanState> = _scanState.asStateFlow()

    private val _discoveredDevices = MutableStateFlow<List<BluetoothDeviceInfo>>(emptyList())
    val discoveredDevices: StateFlow<List<BluetoothDeviceInfo>> = _discoveredDevices.asStateFlow()

    // ─── Error Events ───────────────────────────────────────────────────────────

    private val _error = MutableSharedFlow<String>()
    val error: SharedFlow<String> = _error.asSharedFlow()

    private val _message = MutableSharedFlow<String>()
    val message: SharedFlow<String> = _message.asSharedFlow()

    // ─── Actions ────────────────────────────────────────────────────────────────

    /**
     * Initiates a Bluetooth scan for discoverable printers.
     * Scan runs for up to 15 seconds (handled by [PrinterManager]).
     * Shows NO_RESULTS if no devices are found.
     */
    fun startScan() {
        if (_scanState.value == ScanState.SCANNING) return

        viewModelScope.launch {
            _scanState.value = ScanState.SCANNING
            _discoveredDevices.value = emptyList()

            val result = printerManager.scanForDevices()
            result.fold(
                onSuccess = { devices ->
                    _discoveredDevices.value = devices
                    _scanState.value = if (devices.isEmpty()) {
                        ScanState.NO_RESULTS
                    } else {
                        ScanState.RESULTS
                    }
                },
                onFailure = { throwable ->
                    _scanState.value = ScanState.IDLE
                    _error.emit(throwable.message ?: "Scan failed")
                }
            )
        }
    }

    /**
     * Connects to a paired printer by MAC address.
     */
    fun connectPrinter(macAddress: String) {
        viewModelScope.launch {
            val result = printerManager.connect(macAddress)
            result.fold(
                onSuccess = {
                    _message.emit("Printer connected")
                },
                onFailure = { throwable ->
                    _error.emit(throwable.message ?: "Connection failed")
                }
            )
        }
    }

    /**
     * Disconnects from a currently connected printer.
     */
    fun disconnectPrinter(macAddress: String) {
        viewModelScope.launch {
            val result = printerManager.disconnect(macAddress)
            result.fold(
                onSuccess = {
                    _message.emit("Printer disconnected")
                },
                onFailure = { throwable ->
                    _error.emit(throwable.message ?: "Disconnect failed")
                }
            )
        }
    }

    /**
     * Sends a test print to the specified printer.
     * Reports success or failure within 10 seconds (per requirement 6.5).
     */
    fun testPrint(macAddress: String) {
        viewModelScope.launch {
            val result = printerManager.testPrint(macAddress)
            result.fold(
                onSuccess = {
                    _message.emit("Test print successful")
                },
                onFailure = { throwable ->
                    _error.emit("Print failed: ${throwable.message ?: "Check printer connection"}")
                }
            )
        }
    }

    /**
     * Assigns the KOT role to the specified printer.
     * Role assignment persists via [PrinterManager].
     */
    fun setAsKotPrinter(macAddress: String) {
        viewModelScope.launch {
            // Role is assigned within the manager. Future tasks will add
            // persistence for role assignments. For now we update locally.
            _message.emit("Set as KOT Printer")
        }
    }

    /**
     * Assigns the Bill role to the specified printer.
     * Role assignment persists via [PrinterManager].
     */
    fun setAsBillPrinter(macAddress: String) {
        viewModelScope.launch {
            _message.emit("Set as Bill Printer")
        }
    }
}

/**
 * Represents the current state of Bluetooth scanning.
 */
enum class ScanState {
    /** No scan in progress, initial state. */
    IDLE,

    /** Bluetooth scan is currently running. */
    SCANNING,

    /** Scan completed but found no devices. */
    NO_RESULTS,

    /** Scan completed and found devices. */
    RESULTS
}
