package com.dajaj.pos.bluetooth.scanner

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import com.dajaj.pos.common.Constants
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume

/**
 * Handles the Bluetooth pairing workflow for thermal printers.
 *
 * Manages the process of initiating Bluetooth bonding and listening for
 * [BluetoothDevice.ACTION_BOND_STATE_CHANGED] broadcast to confirm pairing
 * success or failure.
 *
 * Enforces a maximum of [Constants.MAX_PAIRED_PRINTERS] paired printers.
 */
@Singleton
class BluetoothPairingHelper @Inject constructor(
    @ApplicationContext private val context: Context,
    private val bluetoothAdapter: BluetoothAdapter?
) {

    /**
     * Initiates Bluetooth bonding with a device at the given MAC address.
     *
     * The method:
     * 1. Validates that the paired printer limit has not been reached
     * 2. Cancels any active Bluetooth discovery (required before pairing)
     * 3. Initiates bonding via [BluetoothDevice.createBond]
     * 4. Listens for BOND_STATE_CHANGED to confirm pairing success
     *
     * @param macAddress The Bluetooth MAC address to pair with (format: XX:XX:XX:XX:XX:XX).
     * @return [Result.success] when bonding completes (BOND_BONDED),
     *         [Result.failure] on timeout, bonding failure, or if the limit is reached.
     */
    @SuppressLint("MissingPermission")
    suspend fun pairDevice(macAddress: String): Result<Unit> {
        val adapter = bluetoothAdapter
            ?: return Result.failure(BluetoothDisabledException("Bluetooth adapter not available"))

        if (!adapter.isEnabled) {
            return Result.failure(BluetoothDisabledException("Bluetooth is disabled"))
        }

        requireBluetoothConnectPermission()

        // Enforce MAX_PAIRED_PRINTERS limit
        val currentPairedCount = adapter.bondedDevices?.size ?: 0
        if (currentPairedCount >= Constants.MAX_PAIRED_PRINTERS) {
            return Result.failure(
                MaxPairedPrintersException(
                    "Maximum of ${Constants.MAX_PAIRED_PRINTERS} paired printers reached. " +
                        "Unpair an existing printer before adding a new one."
                )
            )
        }

        val device = adapter.getRemoteDevice(macAddress)
            ?: return Result.failure(IllegalArgumentException("Invalid MAC address: $macAddress"))

        // If already bonded, return success immediately
        if (device.bondState == BluetoothDevice.BOND_BONDED) {
            return Result.success(Unit)
        }

        // Cancel discovery before pairing (Android requirement)
        adapter.cancelDiscovery()

        return try {
            withTimeout(Constants.BLUETOOTH_SCAN_TIMEOUT_MS) {
                awaitBonding(device)
            }
        } catch (e: kotlinx.coroutines.TimeoutCancellationException) {
            Result.failure(PairingTimeoutException("Pairing timed out after ${Constants.BLUETOOTH_SCAN_TIMEOUT_MS / 1000} seconds"))
        }
    }

    /**
     * Suspends until the device bonding is complete (BOND_BONDED) or fails (BOND_NONE).
     * Uses a BroadcastReceiver to listen for BOND_STATE_CHANGED events.
     */
    @SuppressLint("MissingPermission")
    private suspend fun awaitBonding(device: BluetoothDevice): Result<Unit> =
        suspendCancellableCoroutine { continuation ->
            val receiver = object : BroadcastReceiver() {
                override fun onReceive(context: Context, intent: Intent) {
                    if (intent.action != BluetoothDevice.ACTION_BOND_STATE_CHANGED) return

                    val bondedDevice: BluetoothDevice = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        intent.getParcelableExtra(
                            BluetoothDevice.EXTRA_DEVICE,
                            BluetoothDevice::class.java
                        )
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
                    } ?: return

                    // Only handle events for the device we're pairing with
                    if (bondedDevice.address != device.address) return

                    val bondState = intent.getIntExtra(
                        BluetoothDevice.EXTRA_BOND_STATE,
                        BluetoothDevice.BOND_NONE
                    )

                    when (bondState) {
                        BluetoothDevice.BOND_BONDED -> {
                            unregisterSafely(this)
                            if (continuation.isActive) {
                                continuation.resume(Result.success(Unit))
                            }
                        }

                        BluetoothDevice.BOND_NONE -> {
                            unregisterSafely(this)
                            if (continuation.isActive) {
                                continuation.resume(
                                    Result.failure(PairingFailedException("Pairing failed for device: ${device.address}"))
                                )
                            }
                        }
                        // BOND_BONDING — still in progress, do nothing
                    }
                }
            }

            val filter = IntentFilter(BluetoothDevice.ACTION_BOND_STATE_CHANGED)
            context.registerReceiver(receiver, filter)

            // Initiate bonding
            val bondInitiated = device.createBond()
            if (!bondInitiated) {
                unregisterSafely(receiver)
                if (continuation.isActive) {
                    continuation.resume(
                        Result.failure(PairingFailedException("Failed to initiate bonding with device: ${device.address}"))
                    )
                }
            }

            continuation.invokeOnCancellation {
                unregisterSafely(receiver)
            }
        }

    /**
     * Safely unregisters a BroadcastReceiver, ignoring any exception if already unregistered.
     */
    private fun unregisterSafely(receiver: BroadcastReceiver) {
        try {
            context.unregisterReceiver(receiver)
        } catch (_: IllegalArgumentException) {
            // Receiver already unregistered
        }
    }

    /**
     * Verifies that the required Bluetooth connect permission is granted.
     * On API 31+ (Android 12), BLUETOOTH_CONNECT is required.
     *
     * @throws SecurityException if the required permission is not granted.
     */
    private fun requireBluetoothConnectPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val permission = context.checkSelfPermission(android.Manifest.permission.BLUETOOTH_CONNECT)
            if (permission != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                throw SecurityException("BLUETOOTH_CONNECT permission not granted (required on API 31+)")
            }
        }
    }
}

/**
 * Thrown when the maximum number of paired printers has been reached.
 */
class MaxPairedPrintersException(message: String) : Exception(message)

/**
 * Thrown when pairing fails (device rejects or bonding does not complete).
 */
class PairingFailedException(message: String) : Exception(message)

/**
 * Thrown when the pairing process exceeds the allowed timeout.
 */
class PairingTimeoutException(message: String) : Exception(message)
