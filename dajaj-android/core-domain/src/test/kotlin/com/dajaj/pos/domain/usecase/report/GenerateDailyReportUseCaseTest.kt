package com.dajaj.pos.domain.usecase.report

import com.dajaj.pos.common.Result
import com.dajaj.pos.domain.model.OrderChannel
import com.dajaj.pos.domain.repository.OrderSummary
import com.dajaj.pos.domain.repository.ReportRepository
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class GenerateDailyReportUseCaseTest {

    private lateinit var reportRepository: ReportRepository
    private lateinit var useCase: GenerateDailyReportUseCase
    private val testZone = ZoneId.of("Asia/Kolkata")
    private val testDate = LocalDate.of(2024, 6, 15)
    private val testRestaurantId = "dajaj_main"

    @Before
    fun setup() {
        reportRepository = mockk()
        useCase = GenerateDailyReportUseCase(reportRepository)
    }

    @Test
    fun `empty orders returns zero-value report`() = runTest {
        coEvery {
            reportRepository.getOrdersForDateRange(any(), any(), eq(testRestaurantId))
        } returns Result.Success(emptyList())

        val result = useCase(testDate, testRestaurantId, testZone)

        assertTrue(result.isSuccess)
        val report = (result as Result.Success).data
        assertEquals(testDate, report.date)
        assertEquals(0, report.totalOrders)
        assertEquals(0.0, report.totalRevenue, 0.001)
        assertEquals(0.0, report.averageOrderValue, 0.001)
        assertTrue(report.channelBreakdown.isEmpty())
        assertEquals(0, report.peakHour)
        assertEquals(0, report.peakHourOrderCount)
    }

    @Test
    fun `single order produces correct aggregation`() = runTest {
        val orders = listOf(
            OrderSummary(channel = OrderChannel.WALK_IN, grandTotal = 300.0, createdAtHour = 14)
        )
        coEvery {
            reportRepository.getOrdersForDateRange(any(), any(), eq(testRestaurantId))
        } returns Result.Success(orders)

        val result = useCase(testDate, testRestaurantId, testZone)

        assertTrue(result.isSuccess)
        val report = (result as Result.Success).data
        assertEquals(1, report.totalOrders)
        assertEquals(300.0, report.totalRevenue, 0.001)
        assertEquals(300.0, report.averageOrderValue, 0.001)
        assertEquals(1, report.channelBreakdown.size)
        assertEquals(1, report.channelBreakdown[OrderChannel.WALK_IN]?.orderCount)
        assertEquals(300.0, report.channelBreakdown[OrderChannel.WALK_IN]?.revenue ?: 0.0, 0.001)
        assertEquals(14, report.peakHour)
        assertEquals(1, report.peakHourOrderCount)
    }

    @Test
    fun `multiple orders across channels produces correct breakdown`() = runTest {
        val orders = listOf(
            OrderSummary(channel = OrderChannel.WALK_IN, grandTotal = 200.0, createdAtHour = 12),
            OrderSummary(channel = OrderChannel.WALK_IN, grandTotal = 150.0, createdAtHour = 12),
            OrderSummary(channel = OrderChannel.WHATSAPP, grandTotal = 300.0, createdAtHour = 14),
            OrderSummary(channel = OrderChannel.WEBSITE, grandTotal = 250.0, createdAtHour = 18)
        )
        coEvery {
            reportRepository.getOrdersForDateRange(any(), any(), eq(testRestaurantId))
        } returns Result.Success(orders)

        val result = useCase(testDate, testRestaurantId, testZone)

        assertTrue(result.isSuccess)
        val report = (result as Result.Success).data
        assertEquals(4, report.totalOrders)
        assertEquals(900.0, report.totalRevenue, 0.001)
        assertEquals(225.0, report.averageOrderValue, 0.001)

        // Channel breakdown
        assertEquals(3, report.channelBreakdown.size)
        assertEquals(2, report.channelBreakdown[OrderChannel.WALK_IN]?.orderCount)
        assertEquals(350.0, report.channelBreakdown[OrderChannel.WALK_IN]?.revenue ?: 0.0, 0.001)
        assertEquals(1, report.channelBreakdown[OrderChannel.WHATSAPP]?.orderCount)
        assertEquals(300.0, report.channelBreakdown[OrderChannel.WHATSAPP]?.revenue ?: 0.0, 0.001)
        assertEquals(1, report.channelBreakdown[OrderChannel.WEBSITE]?.orderCount)
        assertEquals(250.0, report.channelBreakdown[OrderChannel.WEBSITE]?.revenue ?: 0.0, 0.001)
    }

    @Test
    fun `peak hour identifies hour with most orders`() = runTest {
        val orders = listOf(
            OrderSummary(channel = OrderChannel.WALK_IN, grandTotal = 100.0, createdAtHour = 12),
            OrderSummary(channel = OrderChannel.WALK_IN, grandTotal = 100.0, createdAtHour = 12),
            OrderSummary(channel = OrderChannel.WALK_IN, grandTotal = 100.0, createdAtHour = 12),
            OrderSummary(channel = OrderChannel.WHATSAPP, grandTotal = 100.0, createdAtHour = 18),
            OrderSummary(channel = OrderChannel.WEBSITE, grandTotal = 100.0, createdAtHour = 18)
        )
        coEvery {
            reportRepository.getOrdersForDateRange(any(), any(), eq(testRestaurantId))
        } returns Result.Success(orders)

        val result = useCase(testDate, testRestaurantId, testZone)

        assertTrue(result.isSuccess)
        val report = (result as Result.Success).data
        assertEquals(12, report.peakHour)
        assertEquals(3, report.peakHourOrderCount)
    }

    @Test
    fun `repository error propagates as Result Error`() = runTest {
        coEvery {
            reportRepository.getOrdersForDateRange(any(), any(), eq(testRestaurantId))
        } returns Result.Error("Network error")

        val result = useCase(testDate, testRestaurantId, testZone)

        assertTrue(result.isError)
        assertEquals("Network error", (result as Result.Error).message)
    }

    @Test
    fun `date boundaries use correct timezone`() = runTest {
        val zone = ZoneId.of("Asia/Kolkata") // UTC+5:30
        val date = LocalDate.of(2024, 6, 15)

        // Expected: start = 2024-06-15T00:00:00+05:30 = 2024-06-14T18:30:00Z
        val expectedStartMillis = date.atStartOfDay(zone).toInstant().toEpochMilli()
        // Expected: end = 2024-06-16T00:00:00+05:30 = 2024-06-15T18:30:00Z
        val expectedEndMillis = date.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()

        coEvery {
            reportRepository.getOrdersForDateRange(
                eq(expectedStartMillis),
                eq(expectedEndMillis),
                eq(testRestaurantId)
            )
        } returns Result.Success(emptyList())

        val result = useCase(date, testRestaurantId, zone)

        assertTrue(result.isSuccess)
    }

    @Test
    fun `aggregate handles all channels correctly`() {
        val orders = listOf(
            OrderSummary(channel = OrderChannel.WALK_IN, grandTotal = 100.0, createdAtHour = 10),
            OrderSummary(channel = OrderChannel.WHATSAPP, grandTotal = 200.0, createdAtHour = 11),
            OrderSummary(channel = OrderChannel.WEBSITE, grandTotal = 150.0, createdAtHour = 12),
            OrderSummary(channel = OrderChannel.QR, grandTotal = 175.0, createdAtHour = 13),
            OrderSummary(channel = OrderChannel.SWIGGY, grandTotal = 250.0, createdAtHour = 14),
            OrderSummary(channel = OrderChannel.ZOMATO, grandTotal = 225.0, createdAtHour = 15)
        )

        val report = useCase.aggregate(testDate, orders)

        assertEquals(6, report.totalOrders)
        assertEquals(1100.0, report.totalRevenue, 0.001)
        assertEquals(6, report.channelBreakdown.size)
        // Each channel has exactly 1 order
        report.channelBreakdown.values.forEach { stats ->
            assertEquals(1, stats.orderCount)
        }
    }

    @Test
    fun `peak hour resolves to first hour when tied`() {
        // When multiple hours have the same count, maxByOrNull returns first max
        val orders = listOf(
            OrderSummary(channel = OrderChannel.WALK_IN, grandTotal = 100.0, createdAtHour = 5),
            OrderSummary(channel = OrderChannel.WALK_IN, grandTotal = 100.0, createdAtHour = 20)
        )

        val report = useCase.aggregate(testDate, orders)

        // Both hours have 1 order; the first encountered max index (5) wins
        assertEquals(5, report.peakHour)
        assertEquals(1, report.peakHourOrderCount)
    }
}
