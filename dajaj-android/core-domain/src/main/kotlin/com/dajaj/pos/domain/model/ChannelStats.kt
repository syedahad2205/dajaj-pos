package com.dajaj.pos.domain.model

/**
 * Aggregated statistics for a single order channel within a reporting period.
 *
 * Used as part of [DailyReport] to break down performance by channel
 * (walk-in, WhatsApp, website, etc.).
 */
data class ChannelStats(
    /** The order channel these stats belong to. */
    val channel: OrderChannel,

    /** Total number of orders from this channel in the period. */
    val orderCount: Int,

    /** Total revenue (sum of grandTotal) from this channel in the period. */
    val revenue: Double
)
