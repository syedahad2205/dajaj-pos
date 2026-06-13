package com.dajaj.pos.domain.model

import java.time.LocalDate

/**
 * Aggregated daily sales report for a restaurant.
 *
 * Contains order counts, revenue, channel breakdowns, and peak hour analysis
 * for a single calendar day (00:00–23:59 in the restaurant's configured timezone).
 */
data class DailyReport(
    /** The date this report covers. */
    val date: LocalDate,

    /** Total number of orders across all channels for the day. */
    val totalOrders: Int,

    /** Total revenue (sum of grandTotal) across all channels for the day. */
    val totalRevenue: Double,

    /** Average order value (totalRevenue / totalOrders), or 0.0 if no orders. */
    val averageOrderValue: Double,

    /** Breakdown of order count and revenue per channel. */
    val channelBreakdown: Map<OrderChannel, ChannelStats>,

    /** The hour (0–23) with the highest order count. 0 if no orders. */
    val peakHour: Int,

    /** Number of orders in the peak hour slot. 0 if no orders. */
    val peakHourOrderCount: Int
)
