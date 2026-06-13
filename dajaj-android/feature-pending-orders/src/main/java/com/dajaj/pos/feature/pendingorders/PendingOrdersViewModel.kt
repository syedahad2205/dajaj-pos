package com.dajaj.pos.feature.pendingorders

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dajaj.pos.common.Result
import com.dajaj.pos.common.network.ConnectivityMonitor
import com.dajaj.pos.common.network.ConnectivityState
import com.dajaj.pos.domain.model.OrderChannel
import com.dajaj.pos.domain.model.PendingOrder
import com.dajaj.pos.domain.repository.PendingOrderRepository
import com.dajaj.pos.domain.usecase.pendingorder.RejectPendingOrderUseCase
import com.dajaj.pos.feature.pendingorders.model.ChannelTab
import com.dajaj.pos.feature.pendingorders.model.PendingOrdersUiState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * ViewModel for the Pending Orders screen.
 *
 * Observes pending orders from the repository in real-time, filters by selected
 * channel tab, and handles accept/reject actions. Also exposes connectivity state
 * for the warning banner (shown within 5s of Firestore listener disconnect).
 */
@HiltViewModel
class PendingOrdersViewModel @Inject constructor(
    private val pendingOrderRepository: PendingOrderRepository,
    private val rejectPendingOrderUseCase: RejectPendingOrderUseCase,
    private val connectivityMonitor: ConnectivityMonitor
) : ViewModel() {

    private val _uiState = MutableStateFlow(PendingOrdersUiState())
    val uiState: StateFlow<PendingOrdersUiState> = _uiState.asStateFlow()

    /** One-shot UI events (snackbar messages). */
    private val _events = MutableSharedFlow<PendingOrdersEvent>()
    val events: SharedFlow<PendingOrdersEvent> = _events.asSharedFlow()

    /** Job tracking the connectivity warning delay. */
    private var connectivityWarningJob: Job? = null

    private val restaurantId = "dajaj_main"

    init {
        observePendingOrders()
        observeConnectivity()
    }

    // --- Observation ---

    /**
     * Starts observing pending orders from the repository.
     * The flow emits a new list every time orders change in Firestore.
     */
    private fun observePendingOrders() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            pendingOrderRepository.observePendingOrders(restaurantId)
                .catch { throwable ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            error = throwable.message ?: "Failed to load pending orders"
                        )
                    }
                }
                .collect { orders ->
                    _uiState.update { state ->
                        state.copy(
                            orders = orders,
                            filteredOrders = filterOrders(orders, state.selectedTab),
                            isLoading = false,
                            isRefreshing = false,
                            error = null
                        )
                    }
                }
        }
    }

    /**
     * Observes network connectivity. Shows connectivity warning banner within 5s
     * of disconnection per requirement 4.8.
     */
    private fun observeConnectivity() {
        viewModelScope.launch {
            connectivityMonitor.connectivityState.collect { state ->
                when (state) {
                    ConnectivityState.OFFLINE -> {
                        // Start a 5-second timer; show banner if still offline
                        connectivityWarningJob?.cancel()
                        connectivityWarningJob = viewModelScope.launch {
                            delay(CONNECTIVITY_WARNING_DELAY_MS)
                            _uiState.update { it.copy(isConnected = false) }
                        }
                    }
                    ConnectivityState.ONLINE -> {
                        connectivityWarningJob?.cancel()
                        _uiState.update { it.copy(isConnected = true) }
                    }
                }
            }
        }
    }

    // --- Actions ---

    /**
     * Changes the active filter tab and re-filters the order list.
     */
    fun selectTab(tab: ChannelTab) {
        _uiState.update { state ->
            state.copy(
                selectedTab = tab,
                filteredOrders = filterOrders(state.orders, tab)
            )
        }
    }

    /**
     * Triggers a pull-to-refresh. Since we use a real-time listener, this
     * simply sets the refreshing indicator which the listener will clear
     * on the next emission.
     */
    fun refresh() {
        _uiState.update { it.copy(isRefreshing = true) }
        // The real-time listener will emit the latest data, clearing the refresh state.
        // If no new data arrives within a reasonable time, stop the spinner.
        viewModelScope.launch {
            delay(REFRESH_TIMEOUT_MS)
            _uiState.update { it.copy(isRefreshing = false) }
        }
    }

    /**
     * Accepts a pending order. On success, the order disappears from the list
     * because the Firestore listener filters by status = "pending".
     */
    fun acceptOrder(order: PendingOrder) {
        viewModelScope.launch {
            when (val result = pendingOrderRepository.acceptOrder(order.id)) {
                is Result.Success -> {
                    _events.emit(
                        PendingOrdersEvent.ShowMessage(
                            "Order #${order.orderNumber} accepted"
                        )
                    )
                }
                is Result.Error -> {
                    _events.emit(
                        PendingOrdersEvent.ShowError(
                            "Failed to accept order: ${result.message}"
                        )
                    )
                }
                is Result.Loading -> { /* No-op */ }
            }
        }
    }

    /**
     * Rejects a pending order with a reason.
     */
    fun rejectOrder(orderId: String, reason: String) {
        viewModelScope.launch {
            when (val result = rejectPendingOrderUseCase(orderId, reason)) {
                is Result.Success -> {
                    _events.emit(PendingOrdersEvent.ShowMessage("Order rejected"))
                }
                is Result.Error -> {
                    _events.emit(
                        PendingOrdersEvent.ShowError(
                            "Failed to reject order: ${result.message}"
                        )
                    )
                }
                is Result.Loading -> { /* No-op */ }
            }
        }
    }

    // --- Private Helpers ---

    /**
     * Filters orders by the selected channel tab.
     */
    private fun filterOrders(
        orders: List<PendingOrder>,
        tab: ChannelTab
    ): List<PendingOrder> {
        return when (tab) {
            ChannelTab.ALL -> orders
            ChannelTab.WHATSAPP -> orders.filter { it.channel == OrderChannel.WHATSAPP }
            ChannelTab.WEBSITE -> orders.filter { it.channel == OrderChannel.WEBSITE }
            ChannelTab.QR -> orders.filter { it.channel == OrderChannel.QR }
        }
    }

    companion object {
        /** Show connectivity warning banner after this delay in milliseconds. */
        private const val CONNECTIVITY_WARNING_DELAY_MS = 5000L

        /** Maximum time to wait for refresh data before hiding the spinner. */
        private const val REFRESH_TIMEOUT_MS = 10000L
    }
}

/**
 * One-shot UI events emitted by the ViewModel.
 */
sealed class PendingOrdersEvent {
    data class ShowMessage(val message: String) : PendingOrdersEvent()
    data class ShowError(val message: String) : PendingOrdersEvent()
}
