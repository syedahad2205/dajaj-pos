package com.dajaj.pos.bluetooth.model

/**
 * Represents a Bluetooth device discovered during scanning.
 */
data class BluetoothDeviceInfo(
    /** Device name as reported by Bluetooth adapter (may be null for unnamed devices). */
    val name: String?,

    /** Bluetooth MAC address (format: XX:XX:XX:XX:XX:XX). */
    val macAddress: String,

    /** Whether this device is already paired with the Android device. */
    val isPaired: Boolean
)
