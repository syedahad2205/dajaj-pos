package com.dajaj.pos.domain.repository

import com.dajaj.pos.common.Result
import com.dajaj.pos.domain.model.OrderChannel

/**
 * Repository interface for fetching order data needed for report aggregation.
 *
 * Queries Firestore orders by date range and restaurant, returning lightweight
 * summaries suitable for aggregation without full order documents.
 */
interface ReportRepository {

    /**
     * Fetches orders within the specified timestamp range for a restaurant.
     *
     * @param startMillis Start of the date range (inclusive) as epoch milliseconds.
     * @param endMillis End of the date range (exclusive) as epoch milliseconds.
     * @param restaurantId The restaurant to query orders for.
     * @return Result containing a list of lightweight order summaries for aggregation.
     */
    suspend fun getOrdersForDateRange(
        startMillis: Long,
        endMillis: Long,
        restaurantId: String
    ): Result<List<OrderSummary>>
}

/**
 * Lightweight order data used for report aggregation.
 *
 * Contains only the fields needed to calculate totals, channel breakdowns,
 * and peak hour analysis without loading full order documents.
 */
data class OrderSummary(
    /** The order channel (walk_in, whatsapp, website, etc.). */
    val channel: OrderChannel,

    /** The grand total of the order. */
    val grandTotal: Double,

    /** The hour of the day (0–23) when the order was created. */
    val createdAtHour: Int
)
