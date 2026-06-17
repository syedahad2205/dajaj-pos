package com.dajaj.pos.data.connectivity

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import com.dajaj.pos.domain.repository.DomainConnectivityMonitor
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Data-layer implementation of [DomainConnectivityMonitor].
 *
 * Bridges Android framework APIs (ConnectivityManager, BluetoothAdapter) to the
 * domain-layer interface so that use cases and ViewModels can observe connectivity
 * without depending on Android framework classes.
 *
 * - Internet status: Uses [ConnectivityManager.NetworkCallback] for real-time updates.
 *   Emits current state immediately upon collection. Updates within 5 seconds of change.
 * - Bluetooth status: Uses [BroadcastReceiver] for [BluetoothAdapter.ACTION_STATE_CHANGED].
 *   Emits current state immediately upon collection.
 * - Synchronous check: Queries active network capabilities directly.
 *
 * Requirements: 12.5, 12.6
 */
@Singleton
class DomainConnectivityMonitorImpl @Inject constructor(
    @ApplicationContext private val context: Context,
    private val connectivityManager: ConnectivityManager
) : DomainConnectivityMonitor {

    private val bluetoothAdapter: BluetoothAdapter? by lazy {
        val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        bluetoothManager?.adapter
    }

    /**
     * Observes internet connectivity status as a reactive Flow.
     * Emits `true` when internet is available, `false` when unavailable.
     * Emits the current state immediately upon collection.
     * The offline status banner must appear within 5 seconds of connection loss.
     */
    override fun observeInternetStatus(): Flow<Boolean> = callbackFlow {
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                trySend(true)
            }

            override fun onLost(network: Network) {
                trySend(false)
            }

            override fun onCapabilitiesChanged(
                network: Network,
                networkCapabilities: NetworkCapabilities
            ) {
                val hasInternet = networkCapabilities.hasCapability(
                    NetworkCapabilities.NET_CAPABILITY_INTERNET
                )
                trySend(hasInternet)
            }
        }

        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()

        connectivityManager.registerNetworkCallback(request, callback)

        // Emit initial state immediately
        trySend(isOnline())

        awaitClose {
            connectivityManager.unregisterNetworkCallback(callback)
        }
    }.distinctUntilChanged()

    /**
     * Observes Bluetooth adapter status as a reactive Flow.
     * Emits `true` when Bluetooth is enabled and available, `false` otherwise.
     * Uses BroadcastReceiver for BluetoothAdapter.ACTION_STATE_CHANGED.
     */
    override fun observeBluetoothStatus(): Flow<Boolean> = callbackFlow {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (intent.action == BluetoothAdapter.ACTION_STATE_CHANGED) {
                    val state = intent.getIntExtra(
                        BluetoothAdapter.EXTRA_STATE,
                        BluetoothAdapter.ERROR
                    )
                    trySend(state == BluetoothAdapter.STATE_ON)
                }
            }
        }

        val filter = IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED)
        context.registerReceiver(receiver, filter)

        // Emit initial state immediately
        trySend(bluetoothAdapter?.isEnabled == true)

        awaitClose {
            context.unregisterReceiver(receiver)
        }
    }.distinctUntilChanged()

    /**
     * Returns whether the device currently has internet connectivity.
     * Synchronous check for use in conditional branching.
     */
    override fun isOnline(): Boolean {
        val activeNetwork = connectivityManager.activeNetwork ?: return false
        val capabilities = connectivityManager.getNetworkCapabilities(activeNetwork) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }
}
