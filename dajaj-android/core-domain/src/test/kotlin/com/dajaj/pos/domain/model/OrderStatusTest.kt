package com.dajaj.pos.domain.model

import org.junit.Assert.assertEquals
import org.junit.Test

class OrderStatusTest {

    @Test
    fun `fromString maps lowercase strings correctly`() {
        assertEquals(OrderStatus.PENDING, OrderStatus.fromString("pending"))
        assertEquals(OrderStatus.ACCEPTED, OrderStatus.fromString("accepted"))
        assertEquals(OrderStatus.REJECTED, OrderStatus.fromString("rejected"))
        assertEquals(OrderStatus.PREPARING, OrderStatus.fromString("preparing"))
        assertEquals(OrderStatus.READY, OrderStatus.fromString("ready"))
        assertEquals(OrderStatus.COMPLETED, OrderStatus.fromString("completed"))
        assertEquals(OrderStatus.CANCELLED, OrderStatus.fromString("cancelled"))
    }

    @Test
    fun `fromString is case-insensitive`() {
        assertEquals(OrderStatus.PENDING, OrderStatus.fromString("PENDING"))
        assertEquals(OrderStatus.ACCEPTED, OrderStatus.fromString("Accepted"))
        assertEquals(OrderStatus.PREPARING, OrderStatus.fromString("PREPARING"))
    }

    @Test
    fun `fromString returns PENDING for unknown values`() {
        assertEquals(OrderStatus.PENDING, OrderStatus.fromString("unknown"))
        assertEquals(OrderStatus.PENDING, OrderStatus.fromString(""))
        assertEquals(OrderStatus.PENDING, OrderStatus.fromString("invalid"))
    }

    @Test
    fun `toFirestoreValue returns lowercase strings`() {
        assertEquals("pending", OrderStatus.PENDING.toFirestoreValue())
        assertEquals("accepted", OrderStatus.ACCEPTED.toFirestoreValue())
        assertEquals("rejected", OrderStatus.REJECTED.toFirestoreValue())
        assertEquals("preparing", OrderStatus.PREPARING.toFirestoreValue())
        assertEquals("ready", OrderStatus.READY.toFirestoreValue())
        assertEquals("completed", OrderStatus.COMPLETED.toFirestoreValue())
        assertEquals("cancelled", OrderStatus.CANCELLED.toFirestoreValue())
    }

    @Test
    fun `fromString and toFirestoreValue are inverses`() {
        OrderStatus.values().forEach { status ->
            assertEquals(status, OrderStatus.fromString(status.toFirestoreValue()))
        }
    }
}
