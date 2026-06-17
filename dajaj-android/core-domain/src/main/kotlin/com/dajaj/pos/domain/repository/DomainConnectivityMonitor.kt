package com.dajaj.pos.domain.repository

import kotlinx.coroutines.flow.Flow

/**
 * Domain-layer interface for observing device connectivity state.
 *
 * Abstracts internet and Bluetooth connectivity observation so the domain
 * and use case layers can react to connectivity changes without depending on
 * Android framework classes (ConnectivityManager, BluetoothAdapter).
 *
 * Implementations live in the data layer (e.g., wrapping Android's
 * ConnectivityManager and BluetoothAdapter callbacks).
 */
interface DomainConnectivityMonitor {

    /**
     * Observes internet connectivity status as a reactive Flow.
     * Emits `true` when internet is available, `false` when unavailable.
     * Should emit the current state immediately upon collection.
     *
     * The offline status banner must appear within 5 seconds of connection loss.
     */
    fun observeInternetStatus(): Flow<Boolean>

    /**
     * Observes Bluetooth adapter status as a reactive Flow.
     * Emits `true` when Bluetooth is enabled and available, `false` otherwise.
     * Used by the Print Agent to determine if printing is possible.
     */
    fun observeBluetoothStatus(): Flow<Boolean>

    /**
     * Returns whether the device currently has internet connectivity.
     * Synchronous check for use in conditional branching (e.g., deciding
     * whether to write to Firestore or queue locally in Room).
     */
    fun isOnline(): Boolean
}
