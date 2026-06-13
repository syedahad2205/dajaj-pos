package com.dajaj.pos.bluetooth.scanner

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import com.dajaj.pos.bluetooth.model.BluetoothDeviceInfo
import com.dajaj.pos.common.Constants
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Handles Bluetooth device discovery for thermal printers.
 *
 * Emits discovered devices as a Flow during scanning. Already-paired devices are
 * emitted immediately, then new devices are emitted as they are found via
 * BroadcastReceiver for [BluetoothDevice.ACTION_FOUND].
 *
 * Scanning auto-stops after [Constants.BLUETOOTH_SCAN_TIMEOUT_MS] (15 seconds).
 */
@Singleton
class BluetoothScanner @Inject constructor(
    @ApplicationContext private val context: Context,
    private val bluetoothAdapter: BluetoothAdapter?
) {

    @Volatile
    private var isScanning = false

    /**
     * Starts a Bluetooth scan and emits discovered devices.
     *
     * Already-paired devices are emitted first. Then new devices discovered during
     * the scan are emitted as they appear. The flow completes automatically after
     * [Constants.BLUETOOTH_SCAN_TIMEOUT_MS] or when [stopScan] is called.
     *
     * @return A [Flow] emitting [BluetoothDeviceInfo] for each discovered device.
     * @throws BluetoothDisabledException if Bluetooth is not enabled.
     * @throws SecurityException if required Bluetooth permissions are not granted.
     */
    @SuppressLint("MissingPermission")
    fun startScan(): Flow<BluetoothDeviceInfo> = callbackFlow {
        val adapter = bluetoothAdapter
            ?: throw BluetoothDisabledException("Bluetooth adapter not available")

        if (!adapter.isEnabled) {
            throw BluetoothDisabledException("Bluetooth is disabled")
        }

        requireBluetoothScanPermission()

        isScanning = true

        // Track already-emitted MAC addresses to avoid duplicates
        val discoveredAddresses = mutableSetOf<String>()

        // Emit already-paired devices immediately
        val bondedDevices = adapter.bondedDevices.orEmpty()
        for (device in bondedDevices) {
            val info = BluetoothDeviceInfo(
                name = device.name,
                macAddress = device.address,
                isPaired = true
            )
            discoveredAddresses.add(device.address)
            trySend(info)
        }

        // Set up BroadcastReceiver for newly discovered devices
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                when (intent.action) {
                    BluetoothDevice.ACTION_FOUND -> {
                        val device: BluetoothDevice = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                            intent.getParcelableExtra(
                                BluetoothDevice.EXTRA_DEVICE,
                                BluetoothDevice::class.java
                            )
                        } else {
                            @Suppress("DEPRECATION")
                            intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
                        } ?: return

                        if (device.address !in discoveredAddresses) {
                            discoveredAddresses.add(device.address)
                            val info = BluetoothDeviceInfo(
                                name = device.name,
                                macAddress = device.address,
                                isPaired = device.bondState == BluetoothDevice.BOND_BONDED
                            )
                            trySend(info)
                        }
                    }

                    BluetoothAdapter.ACTION_DISCOVERY_FINISHED -> {
                        isScanning = false
                        channel.close()
                    }
                }
            }
        }

        val filter = IntentFilter().apply {
            addAction(BluetoothDevice.ACTION_FOUND)
            addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED)
        }
        context.registerReceiver(receiver, filter)

        // Start Bluetooth discovery
        adapter.startDiscovery()

        // Auto-stop after timeout
        launch {
            delay(Constants.BLUETOOTH_SCAN_TIMEOUT_MS)
            if (isScanning) {
                stopScan()
            }
        }

        awaitClose {
            stopScanInternal()
            try {
                context.unregisterReceiver(receiver)
            } catch (_: IllegalArgumentException) {
                // Receiver may already be unregistered
            }
        }
    }

    /**
     * Cancels the active Bluetooth scan.
     * If no scan is in progress, this is a no-op.
     */
    @SuppressLint("MissingPermission")
    fun stopScan() {
        stopScanInternal()
    }

    @SuppressLint("MissingPermission")
    private fun stopScanInternal() {
        if (isScanning) {
            isScanning = false
            bluetoothAdapter?.cancelDiscovery()
        }
    }

    /**
     * Whether a scan is currently in progress.
     */
    fun isCurrentlyScanning(): Boolean = isScanning

    /**
     * Verifies that the required Bluetooth scan permission is granted.
     * On API 31+ (Android 12), BLUETOOTH_SCAN is required.
     * On older versions, ACCESS_FINE_LOCATION is required for discovery.
     *
     * @throws SecurityException if the required permission is not granted.
     */
    private fun requireBluetoothScanPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // API 31+: BLUETOOTH_SCAN required
            val permission = context.checkSelfPermission(android.Manifest.permission.BLUETOOTH_SCAN)
            if (permission != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                throw SecurityException("BLUETOOTH_SCAN permission not granted (required on API 31+)")
            }
        } else {
            // Pre-API 31: ACCESS_FINE_LOCATION required for discovery
            val permission = context.checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION)
            if (permission != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                throw SecurityException("ACCESS_FINE_LOCATION permission not granted (required for Bluetooth scan)")
            }
        }
    }
}

/**
 * Thrown when Bluetooth is not available or is disabled on the device.
 */
class BluetoothDisabledException(message: String) : Exception(message)
