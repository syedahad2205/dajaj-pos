package com.dajaj.pos.feature.reports

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import javax.inject.Inject

/**
 * ViewModel for the Reports screen.
 *
 * Loads daily report data from the orders collection in Firestore.
 * Exposes a [ReportsUiState] that the fragment observes to display:
 * - Summary: total orders, total revenue, average order value
 * - Channel breakdown: Walk-in, WhatsApp, Website counts and revenue
 * - Peak hour: the 1-hour slot with the highest order count
 * - Bill list for the selected date
 *
 * Requirements: 13.1, 13.4
 */
// TODO: Architecture violation — ViewModel directly accesses Firestore.
// Should use a ReportsRepository/UseCase pattern. Deferred to full arch cleanup.
@HiltViewModel
class ReportsViewModel @Inject constructor(
    private val firestore: FirebaseFirestore
) : ViewModel() {

    private val _uiState = MutableStateFlow(ReportsUiState())
    val uiState: StateFlow<ReportsUiState> = _uiState.asStateFlow()

    private val restaurantId = "dajaj_main"

    init {
        loadReport(Date())
    }

    /**
     * Loads the daily report for the given date.
     * Queries all completed orders within the calendar day boundaries.
     */
    fun loadReport(date: Date) {
        _uiState.update { it.copy(isLoading = true, selectedDate = date) }

        viewModelScope.launch {
            try {
                val (startOfDay, endOfDay) = getDayBoundaries(date)

                val snapshot = firestore.collection("orders")
                    .whereEqualTo("restaurantId", restaurantId)
                    .whereGreaterThanOrEqualTo("createdAt", startOfDay)
                    .whereLessThanOrEqualTo("createdAt", endOfDay)
                    .orderBy("createdAt", Query.Direction.DESCENDING)
                    .get()
                    .await()

                val orders = snapshot.documents.mapNotNull { doc ->
                    parseOrderDocument(doc)
                }

                if (orders.isEmpty()) {
                    _uiState.update {
                        ReportsUiState(
                            isLoading = false,
                            isEmpty = true,
                            selectedDate = date
                        )
                    }
                    return@launch
                }

                // Calculate summary metrics
                val totalOrders = orders.size
                val totalRevenue = orders.sumOf { it.grandTotal }
                val avgOrderValue = if (totalOrders > 0) totalRevenue / totalOrders else 0.0

                // Channel breakdown
                val walkinOrders = orders.filter { it.channel == "walk_in" }
                val whatsappOrders = orders.filter { it.channel == "whatsapp" }
                val websiteOrders = orders.filter { it.channel == "website" }

                val channelBreakdown = ChannelBreakdown(
                    walkinCount = walkinOrders.size,
                    walkinRevenue = walkinOrders.sumOf { it.grandTotal },
                    whatsappCount = whatsappOrders.size,
                    whatsappRevenue = whatsappOrders.sumOf { it.grandTotal },
                    websiteCount = websiteOrders.size,
                    websiteRevenue = websiteOrders.sumOf { it.grandTotal }
                )

                // Peak hour analysis (1-hour slot with highest order count)
                val peakHour = calculatePeakHour(orders)

                // Bill list items
                val billItems = orders.map { order ->
                    BillItem(
                        orderNumber = order.orderNumber,
                        channel = order.channel,
                        grandTotal = order.grandTotal,
                        createdAt = order.createdAt
                    )
                }

                _uiState.update {
                    ReportsUiState(
                        isLoading = false,
                        isEmpty = false,
                        selectedDate = date,
                        totalOrders = totalOrders,
                        totalRevenue = totalRevenue,
                        avgOrderValue = avgOrderValue,
                        channelBreakdown = channelBreakdown,
                        peakHour = peakHour,
                        bills = billItems
                    )
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        error = e.message ?: "Failed to load report"
                    )
                }
            }
        }
    }

    /**
     * Returns the start-of-day and end-of-day timestamps for the given date.
     * Uses the device's default timezone for day boundaries.
     */
    private fun getDayBoundaries(date: Date): Pair<com.google.firebase.Timestamp, com.google.firebase.Timestamp> {
        val calendar = Calendar.getInstance().apply {
            time = date
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        val startOfDay = com.google.firebase.Timestamp(calendar.time)

        calendar.apply {
            set(Calendar.HOUR_OF_DAY, 23)
            set(Calendar.MINUTE, 59)
            set(Calendar.SECOND, 59)
            set(Calendar.MILLISECOND, 999)
        }
        val endOfDay = com.google.firebase.Timestamp(calendar.time)

        return startOfDay to endOfDay
    }

    /**
     * Parses a Firestore document into a [ReportOrder] data class.
     * Returns null if required fields are missing.
     */
    private fun parseOrderDocument(doc: DocumentSnapshot): ReportOrder? {
        if (!doc.exists()) return null

        return try {
            val grandTotal = doc.getDouble("grandTotal") ?: return null
            val channel = doc.getString("channel") ?: return null
            val orderNumber = doc.getString("orderNumber") ?: return null
            val createdAt = parseTimestamp(doc, "createdAt")

            ReportOrder(
                id = doc.id,
                orderNumber = orderNumber,
                channel = channel,
                grandTotal = grandTotal,
                createdAt = createdAt
            )
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Calculates the peak hour: the 1-hour time slot with the highest order count.
     * Groups orders by their hour-of-day and finds the maximum.
     */
    private fun calculatePeakHour(orders: List<ReportOrder>): PeakHour? {
        if (orders.isEmpty()) return null

        val calendar = Calendar.getInstance()
        val hourCounts = mutableMapOf<Int, Int>()

        for (order in orders) {
            calendar.timeInMillis = order.createdAt
            val hour = calendar.get(Calendar.HOUR_OF_DAY)
            hourCounts[hour] = (hourCounts[hour] ?: 0) + 1
        }

        val peakEntry = hourCounts.maxByOrNull { it.value } ?: return null
        val peakHourStart = peakEntry.key

        val timeFormat = SimpleDateFormat("h:mm a", Locale.getDefault())
        calendar.apply {
            set(Calendar.HOUR_OF_DAY, peakHourStart)
            set(Calendar.MINUTE, 0)
        }
        val startLabel = timeFormat.format(calendar.time)

        calendar.add(Calendar.HOUR_OF_DAY, 1)
        val endLabel = timeFormat.format(calendar.time)

        return PeakHour(
            slotLabel = "$startLabel – $endLabel",
            orderCount = peakEntry.value
        )
    }

    /**
     * Parses a timestamp field that may be a Firestore Timestamp or a Long.
     */
    private fun parseTimestamp(doc: DocumentSnapshot, field: String): Long {
        return try {
            doc.getTimestamp(field)?.toDate()?.time ?: doc.getLong(field) ?: 0L
        } catch (e: Exception) {
            doc.getLong(field) ?: 0L
        }
    }
}

/**
 * UI state for the Reports screen.
 */
data class ReportsUiState(
    val isLoading: Boolean = true,
    val isEmpty: Boolean = false,
    val selectedDate: Date = Date(),
    val totalOrders: Int = 0,
    val totalRevenue: Double = 0.0,
    val avgOrderValue: Double = 0.0,
    val channelBreakdown: ChannelBreakdown = ChannelBreakdown(),
    val peakHour: PeakHour? = null,
    val bills: List<BillItem> = emptyList(),
    val error: String? = null
)

/**
 * Channel breakdown metrics.
 */
data class ChannelBreakdown(
    val walkinCount: Int = 0,
    val walkinRevenue: Double = 0.0,
    val whatsappCount: Int = 0,
    val whatsappRevenue: Double = 0.0,
    val websiteCount: Int = 0,
    val websiteRevenue: Double = 0.0
)

/**
 * Peak hour data: the 1-hour slot with highest order count.
 */
data class PeakHour(
    val slotLabel: String,
    val orderCount: Int
)

/**
 * A minimal bill item for the bill list.
 */
data class BillItem(
    val orderNumber: String,
    val channel: String,
    val grandTotal: Double,
    val createdAt: Long
)

/**
 * Internal model for parsing orders from Firestore.
 */
private data class ReportOrder(
    val id: String,
    val orderNumber: String,
    val channel: String,
    val grandTotal: Double,
    val createdAt: Long
)
