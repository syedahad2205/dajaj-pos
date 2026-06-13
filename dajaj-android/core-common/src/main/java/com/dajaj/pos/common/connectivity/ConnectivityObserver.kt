package com.dajaj.pos.common.connectivity

import kotlinx.coroutines.flow.Flow

/**
 * Observes the device's network connectivity state as a reactive [Flow].
 * Implementations should emit [ConnectivityState] changes in real-time.
 */
interface ConnectivityObserver {

    /**
     * Returns a [Flow] that emits [ConnectivityState] whenever connectivity changes.
     * The flow should emit the current state immediately upon collection.
     */
    fun observe(): Flow<ConnectivityState>
}
