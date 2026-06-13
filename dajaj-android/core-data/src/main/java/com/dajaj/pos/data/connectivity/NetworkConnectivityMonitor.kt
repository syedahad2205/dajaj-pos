package com.dajaj.pos.data.connectivity

import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import com.dajaj.pos.common.connectivity.ConnectivityObserver
import com.dajaj.pos.common.connectivity.ConnectivityState
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Implementation of [ConnectivityObserver] that uses Android's [ConnectivityManager]
 * and [ConnectivityManager.NetworkCallback] for real-time connectivity changes.
 *
 * Emits [ConnectivityState.CONNECTED] or [ConnectivityState.DISCONNECTED] within
 * 2 seconds of a network status change.
 */
@Singleton
class NetworkConnectivityMonitor @Inject constructor(
    private val connectivityManager: ConnectivityManager
) : ConnectivityObserver {

    override fun observe(): Flow<ConnectivityState> = callbackFlow {
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                trySend(ConnectivityState.CONNECTED)
            }

            override fun onLost(network: Network) {
                trySend(ConnectivityState.DISCONNECTED)
            }

            override fun onCapabilitiesChanged(
                network: Network,
                networkCapabilities: NetworkCapabilities
            ) {
                val hasInternet = networkCapabilities.hasCapability(
                    NetworkCapabilities.NET_CAPABILITY_INTERNET
                )
                trySend(
                    if (hasInternet) ConnectivityState.CONNECTED
                    else ConnectivityState.DISCONNECTED
                )
            }
        }

        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()

        connectivityManager.registerNetworkCallback(request, callback)

        // Emit initial state immediately upon collection
        val initialState = getCurrentConnectivityState()
        trySend(initialState)

        awaitClose {
            connectivityManager.unregisterNetworkCallback(callback)
        }
    }.distinctUntilChanged()

    private fun getCurrentConnectivityState(): ConnectivityState {
        val activeNetwork = connectivityManager.activeNetwork
            ?: return ConnectivityState.DISCONNECTED
        val capabilities = connectivityManager.getNetworkCapabilities(activeNetwork)
            ?: return ConnectivityState.DISCONNECTED
        return if (capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
            ConnectivityState.CONNECTED
        } else {
            ConnectivityState.DISCONNECTED
        }
    }
}
