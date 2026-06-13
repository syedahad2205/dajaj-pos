package com.dajaj.pos.bluetooth

import com.dajaj.pos.bluetooth.model.BluetoothDeviceInfo
import com.dajaj.pos.bluetooth.model.PrinterConnectionState
import com.dajaj.pos.bluetooth.model.PrinterInfo
import com.dajaj.pos.bluetooth.model.PrinterRole
import kotlinx.coroutines.flow.Flow

/**
 * Core interface for managing Bluetooth thermal printers.
 *
 * This module is isolated from POS business logic — it only handles
 * Bluetooth discovery, pairing, connection lifecycle, and raw data printing.
 */
interface PrinterManager {

    /**
     * Observes the overall Bluetooth printer connection state.
     * Emits whenever the state changes (e.g., connected, disconnected, reconnecting, scanning).
     */
    fun observeConnectionState(): Flow<PrinterConnectionState>

    /**
     * Observes the list of paired printers and their current status.
     * Emits a new list whenever a printer is added, removed, or its state changes.
     */
    fun observePairedPrinters(): Flow<List<PrinterInfo>>

    /**
     * Initiates a Bluetooth scan for discoverable devices.
     *
     * @return A list of discovered Bluetooth devices, or a failure if scanning could not complete.
     */
    suspend fun scanForDevices(): Result<List<BluetoothDeviceInfo>>

    /**
     * Pairs with a Bluetooth device at the given MAC address.
     *
     * @param macAddress The Bluetooth MAC address to pair with (format: XX:XX:XX:XX:XX:XX).
     * @return Success if pairing completed, or a failure with the error reason.
     */
    suspend fun pairDevice(macAddress: String): Result<Unit>

    /**
     * Connects to a previously paired printer.
     *
     * @param macAddress The Bluetooth MAC address to connect to.
     * @return Success if connection established, or a failure with the error reason.
     */
    suspend fun connect(macAddress: String): Result<Unit>

    /**
     * Disconnects from a currently connected printer.
     *
     * @param macAddress The Bluetooth MAC address to disconnect from.
     * @return Success if disconnection completed, or a failure with the error reason.
     */
    suspend fun disconnect(macAddress: String): Result<Unit>

    /**
     * Sends a test print to the specified printer to verify connectivity.
     *
     * @param macAddress The Bluetooth MAC address of the printer to test.
     * @return Success if the test page printed, or a failure with the error reason.
     */
    suspend fun testPrint(macAddress: String): Result<Unit>

    /**
     * Sends raw byte data to the specified printer.
     * The data is expected to be ESC/POS formatted.
     *
     * @param macAddress The Bluetooth MAC address of the target printer.
     * @param data The raw ESC/POS byte array to print.
     * @return Success if printing completed, or a failure with the error reason.
     */
    suspend fun printData(macAddress: String, data: ByteArray): Result<Unit>

    /**
     * Checks whether a printer at the given MAC address is currently connected.
     *
     * @param macAddress The Bluetooth MAC address to check.
     * @return true if the printer is connected, false otherwise.
     */
    fun isConnected(macAddress: String): Boolean

    /**
     * Returns the currently connected printer assigned to the specified role,
     * or null if no connected printer has that role.
     *
     * @param role The printer role to look up (KOT or BILL).
     * @return The [PrinterInfo] for the connected printer with the given role, or null.
     */
    fun getConnectedPrinter(role: PrinterRole): PrinterInfo?
}
