package com.dajaj.pos.ui.main.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dajaj.pos.common.network.ConnectivityMonitor
import com.dajaj.pos.common.network.ConnectivityState
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Printer connection status for the Dashboard status bar.
 */
enum class PrinterStatus {
    CONNECTED,
    RECONNECTING,
    DISCONNECTED
}

/**
 * ViewModel for the Dashboard screen.
 * Provides real-time connectivity state, printer status, pending order count,
 * kitchen preparing count, and cashier name.
 */
@HiltViewModel
class DashboardViewModel @Inject constructor(
    private val connectivityMonitor: ConnectivityMonitor,
    private val firestore: FirebaseFirestore,
    private val firebaseAuth: FirebaseAuth
) : ViewModel() {

    private val _connectivityState = MutableStateFlow(ConnectivityState.ONLINE)
    val connectivityState: StateFlow<ConnectivityState> = _connectivityState.asStateFlow()

    private val _printerStatus = MutableStateFlow(PrinterStatus.DISCONNECTED)
    val printerStatus: StateFlow<PrinterStatus> = _printerStatus.asStateFlow()

    private val _pendingOrderCount = MutableStateFlow(0)
    val pendingOrderCount: StateFlow<Int> = _pendingOrderCount.asStateFlow()

    private val _preparingOrderCount = MutableStateFlow(0)
    val preparingOrderCount: StateFlow<Int> = _preparingOrderCount.asStateFlow()

    private val _cashierName = MutableStateFlow("")
    val cashierName: StateFlow<String> = _cashierName.asStateFlow()

    private val _deviceName = MutableStateFlow("POS Terminal")
    val deviceName: StateFlow<String> = _deviceName.asStateFlow()

    private var pendingOrdersListener: ListenerRegistration? = null
    private var preparingOrdersListener: ListenerRegistration? = null

    init {
        observeConnectivity()
        loadCashierName()
        observePendingOrderCount()
        observePreparingOrderCount()
        loadDeviceInfo()
    }

    private fun observeConnectivity() {
        viewModelScope.launch {
            connectivityMonitor.connectivityState.collect { state ->
                _connectivityState.value = state
            }
        }
    }

    private fun loadCashierName() {
        val currentUser = firebaseAuth.currentUser
        if (currentUser != null) {
            firestore.collection("users")
                .document(currentUser.uid)
                .get()
                .addOnSuccessListener { document ->
                    val name = document.getString("name") ?: currentUser.email ?: "Cashier"
                    _cashierName.value = name
                }
                .addOnFailureListener {
                    _cashierName.value = currentUser.email ?: "Cashier"
                }
        } else {
            _cashierName.value = "Cashier"
        }
    }

    private fun observePendingOrderCount() {
        pendingOrdersListener = firestore.collection("pending_orders")
            .whereEqualTo("restaurantId", "dajaj_main")
            .whereEqualTo("status", "pending")
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    return@addSnapshotListener
                }
                _pendingOrderCount.value = snapshot?.size() ?: 0
            }
    }

    private fun observePreparingOrderCount() {
        preparingOrdersListener = firestore.collection("orders")
            .whereEqualTo("restaurantId", "dajaj_main")
            .whereEqualTo("status", "preparing")
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    return@addSnapshotListener
                }
                _preparingOrderCount.value = snapshot?.size() ?: 0
            }
    }

    private fun loadDeviceInfo() {
        // Load device name from the devices collection
        val currentUser = firebaseAuth.currentUser
        if (currentUser != null) {
            firestore.collection("devices")
                .whereEqualTo("userId", currentUser.uid)
                .limit(1)
                .get()
                .addOnSuccessListener { snapshot ->
                    val device = snapshot.documents.firstOrNull()
                    _deviceName.value = device?.getString("deviceName") ?: "POS Terminal"

                    // Load printer status from device document
                    val printerStatusMap = device?.get("printerStatus") as? Map<*, *>
                    if (printerStatusMap != null) {
                        val status = printerStatusMap["status"] as? String
                        _printerStatus.value = when (status) {
                            "connected" -> PrinterStatus.CONNECTED
                            "reconnecting" -> PrinterStatus.RECONNECTING
                            else -> PrinterStatus.DISCONNECTED
                        }
                    }
                }
        }
    }

    /**
     * Updates the printer status. Called from the UI layer when printer
     * connection state changes are received from the Bluetooth module.
     */
    fun updatePrinterStatus(status: PrinterStatus) {
        _printerStatus.value = status
    }

    override fun onCleared() {
        super.onCleared()
        pendingOrdersListener?.remove()
        preparingOrdersListener?.remove()
    }
}
