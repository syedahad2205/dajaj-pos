package com.dajaj.pos.domain.usecase.report

import com.dajaj.pos.common.Result
import com.dajaj.pos.domain.model.ChannelStats
import com.dajaj.pos.domain.model.DailyReport
import com.dajaj.pos.domain.model.OrderChannel
import com.dajaj.pos.domain.repository.OrderSummary
import com.dajaj.pos.domain.repository.ReportRepository
import java.time.LocalDate
import java.time.ZoneId
import javax.inject.Inject

/**
 * Domain use case for generating a daily sales report.
 *
 * Queries orders for a specific calendar day (00:00–23:59 in the restaurant's timezone)
 * and aggregates: total count, total revenue, average order value, per-channel breakdown,
 * and peak hour analysis.
 *
 * Returns zero values when no orders exist for the requested date.
 */
class GenerateDailyReportUseCase @Inject constructor(
    private val reportRepository: ReportRepository
) {

    /**
     * Generates a daily report for the specified date and restaurant.
     *
     * @param date The calendar date to generate the report for.
     * @param restaurantId The restaurant identifier.
     * @param zoneId The restaurant's timezone for determining day boundaries.
     * @return Result containing the aggregated [DailyReport].
     */
    suspend operator fun invoke(
        date: LocalDate,
        restaurantId: String,
        zoneId: ZoneId = ZoneId.systemDefault()
    ): Result<DailyReport> {
        val startOfDay = date.atStartOfDay(zoneId).toInstant().toEpochMilli()
        val endOfDay = date.plusDays(1).atStartOfDay(zoneId).toInstant().toEpochMilli()

        val ordersResult = reportRepository.getOrdersForDateRange(
            startMillis = startOfDay,
            endMillis = endOfDay,
            restaurantId = restaurantId
        )

        return when (ordersResult) {
            is Result.Success -> Result.Success(aggregate(date, ordersResult.data))
            is Result.Error -> ordersResult
            is Result.Loading -> Result.Error("Unexpected loading state")
        }
    }

    /**
     * Aggregates a list of order summaries into a [DailyReport].
     */
    internal fun aggregate(date: LocalDate, orders: List<OrderSummary>): DailyReport {
        if (orders.isEmpty()) {
            return DailyReport(
                date = date,
                totalOrders = 0,
                totalRevenue = 0.0,
                averageOrderValue = 0.0,
                channelBreakdown = emptyMap(),
                peakHour = 0,
                peakHourOrderCount = 0
            )
        }

        val totalOrders = orders.size
        val totalRevenue = orders.sumOf { it.grandTotal }
        val averageOrderValue = totalRevenue / totalOrders

        // Channel breakdown
        val channelBreakdown = orders
            .groupBy { it.channel }
            .mapValues { (channel, channelOrders) ->
                ChannelStats(
                    channel = channel,
                    orderCount = channelOrders.size,
                    revenue = channelOrders.sumOf { it.grandTotal }
                )
            }

        // Peak hour analysis: find the 1-hour slot with the highest order count
        val hourCounts = IntArray(24)
        orders.forEach { order ->
            hourCounts[order.createdAtHour]++
        }
        val peakHour = hourCounts.indices.maxByOrNull { hourCounts[it] } ?: 0
        val peakHourOrderCount = hourCounts[peakHour]

        return DailyReport(
            date = date,
            totalOrders = totalOrders,
            totalRevenue = totalRevenue,
            averageOrderValue = averageOrderValue,
            channelBreakdown = channelBreakdown,
            peakHour = peakHour,
            peakHourOrderCount = peakHourOrderCount
        )
    }
}
