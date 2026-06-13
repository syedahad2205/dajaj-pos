package com.dajaj.pos.feature.pendingorders.model

import com.dajaj.pos.domain.model.PendingOrder

/**
 * Represents the full UI state for the Pending Orders screen.
 */
data class PendingOrdersUiState(
    val orders: List<PendingOrder> = emptyList(),
    val filteredOrders: List<PendingOrder> = emptyList(),
    val selectedTab: ChannelTab = ChannelTab.ALL,
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val isConnected: Boolean = true,
    val error: String? = null
) {
    val isEmpty: Boolean get() = filteredOrders.isEmpty() && !isLoading
}

/**
 * Tab options for filtering pending orders by channel.
 */
enum class ChannelTab {
    ALL,
    WHATSAPP,
    WEBSITE,
    QR
}
