package com.dajaj.pos.domain.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class OrderStateMachineTest {

    private lateinit var stateMachine: OrderStateMachine

    @Before
    fun setup() {
        stateMachine = OrderStateMachine()
    }

    // --- Valid transitions from PENDING ---

    @Test
    fun `PENDING to ACCEPTED is valid`() {
        val result = stateMachine.transition(OrderStatus.PENDING, OrderStatus.ACCEPTED)
        assertTrue(result.isSuccess)
        assertEquals(OrderStatus.ACCEPTED, result.getOrNull())
    }

    @Test
    fun `PENDING to REJECTED is valid`() {
        val result = stateMachine.transition(OrderStatus.PENDING, OrderStatus.REJECTED)
        assertTrue(result.isSuccess)
        assertEquals(OrderStatus.REJECTED, result.getOrNull())
    }

    @Test
    fun `PENDING to CANCELLED is valid`() {
        val result = stateMachine.transition(OrderStatus.PENDING, OrderStatus.CANCELLED)
        assertTrue(result.isSuccess)
        assertEquals(OrderStatus.CANCELLED, result.getOrNull())
    }

    // --- Valid transitions from ACCEPTED ---

    @Test
    fun `ACCEPTED to PREPARING is valid`() {
        val result = stateMachine.transition(OrderStatus.ACCEPTED, OrderStatus.PREPARING)
        assertTrue(result.isSuccess)
        assertEquals(OrderStatus.PREPARING, result.getOrNull())
    }

    @Test
    fun `ACCEPTED to CANCELLED is valid`() {
        val result = stateMachine.transition(OrderStatus.ACCEPTED, OrderStatus.CANCELLED)
        assertTrue(result.isSuccess)
        assertEquals(OrderStatus.CANCELLED, result.getOrNull())
    }

    // --- Valid transitions from PREPARING ---

    @Test
    fun `PREPARING to READY is valid`() {
        val result = stateMachine.transition(OrderStatus.PREPARING, OrderStatus.READY)
        assertTrue(result.isSuccess)
        assertEquals(OrderStatus.READY, result.getOrNull())
    }

    @Test
    fun `PREPARING to CANCELLED is valid`() {
        val result = stateMachine.transition(OrderStatus.PREPARING, OrderStatus.CANCELLED)
        assertTrue(result.isSuccess)
        assertEquals(OrderStatus.CANCELLED, result.getOrNull())
    }

    // --- Valid transitions from READY ---

    @Test
    fun `READY to COMPLETED is valid`() {
        val result = stateMachine.transition(OrderStatus.READY, OrderStatus.COMPLETED)
        assertTrue(result.isSuccess)
        assertEquals(OrderStatus.COMPLETED, result.getOrNull())
    }

    @Test
    fun `READY to CANCELLED is valid`() {
        val result = stateMachine.transition(OrderStatus.READY, OrderStatus.CANCELLED)
        assertTrue(result.isSuccess)
        assertEquals(OrderStatus.CANCELLED, result.getOrNull())
    }

    // --- Invalid transitions (skipping states) ---

    @Test
    fun `PENDING to PREPARING is invalid - skips ACCEPTED`() {
        val result = stateMachine.transition(OrderStatus.PENDING, OrderStatus.PREPARING)
        assertTrue(result.isFailure)
    }

    @Test
    fun `PENDING to READY is invalid - skips multiple states`() {
        val result = stateMachine.transition(OrderStatus.PENDING, OrderStatus.READY)
        assertTrue(result.isFailure)
    }

    @Test
    fun `PENDING to COMPLETED is invalid - skips multiple states`() {
        val result = stateMachine.transition(OrderStatus.PENDING, OrderStatus.COMPLETED)
        assertTrue(result.isFailure)
    }

    @Test
    fun `ACCEPTED to READY is invalid - skips PREPARING`() {
        val result = stateMachine.transition(OrderStatus.ACCEPTED, OrderStatus.READY)
        assertTrue(result.isFailure)
    }

    @Test
    fun `ACCEPTED to COMPLETED is invalid - skips multiple states`() {
        val result = stateMachine.transition(OrderStatus.ACCEPTED, OrderStatus.COMPLETED)
        assertTrue(result.isFailure)
    }

    @Test
    fun `PREPARING to COMPLETED is invalid - skips READY`() {
        val result = stateMachine.transition(OrderStatus.PREPARING, OrderStatus.COMPLETED)
        assertTrue(result.isFailure)
    }

    // --- Terminal states have no transitions ---

    @Test
    fun `COMPLETED to any state is invalid`() {
        OrderStatus.values().forEach { target ->
            val result = stateMachine.transition(OrderStatus.COMPLETED, target)
            assertTrue(
                "COMPLETED should not transition to ${target.toFirestoreValue()}",
                result.isFailure
            )
        }
    }

    @Test
    fun `CANCELLED to any state is invalid`() {
        OrderStatus.values().forEach { target ->
            val result = stateMachine.transition(OrderStatus.CANCELLED, target)
            assertTrue(
                "CANCELLED should not transition to ${target.toFirestoreValue()}",
                result.isFailure
            )
        }
    }

    @Test
    fun `REJECTED to any state is invalid`() {
        OrderStatus.values().forEach { target ->
            val result = stateMachine.transition(OrderStatus.REJECTED, target)
            assertTrue(
                "REJECTED should not transition to ${target.toFirestoreValue()}",
                result.isFailure
            )
        }
    }

    // --- Same state transitions are invalid ---

    @Test
    fun `transitioning to same state is invalid`() {
        OrderStatus.values().forEach { status ->
            val result = stateMachine.transition(status, status)
            assertTrue(
                "${status.toFirestoreValue()} should not transition to itself",
                result.isFailure
            )
        }
    }

    // --- Backward transitions are invalid ---

    @Test
    fun `ACCEPTED to PENDING is invalid - backward`() {
        val result = stateMachine.transition(OrderStatus.ACCEPTED, OrderStatus.PENDING)
        assertTrue(result.isFailure)
    }

    @Test
    fun `PREPARING to ACCEPTED is invalid - backward`() {
        val result = stateMachine.transition(OrderStatus.PREPARING, OrderStatus.ACCEPTED)
        assertTrue(result.isFailure)
    }

    @Test
    fun `READY to PREPARING is invalid - backward`() {
        val result = stateMachine.transition(OrderStatus.READY, OrderStatus.PREPARING)
        assertTrue(result.isFailure)
    }

    // --- getTimestampField tests ---

    @Test
    fun `getTimestampField for ACCEPTED returns acceptedAt`() {
        assertEquals("acceptedAt", OrderStateMachine.getTimestampField(OrderStatus.ACCEPTED))
    }

    @Test
    fun `getTimestampField for PREPARING returns preparingAt`() {
        assertEquals("preparingAt", OrderStateMachine.getTimestampField(OrderStatus.PREPARING))
    }

    @Test
    fun `getTimestampField for READY returns readyAt`() {
        assertEquals("readyAt", OrderStateMachine.getTimestampField(OrderStatus.READY))
    }

    @Test
    fun `getTimestampField for COMPLETED returns completedAt`() {
        assertEquals("completedAt", OrderStateMachine.getTimestampField(OrderStatus.COMPLETED))
    }

    @Test
    fun `getTimestampField for PENDING returns null`() {
        assertEquals(null, OrderStateMachine.getTimestampField(OrderStatus.PENDING))
    }

    @Test
    fun `getTimestampField for REJECTED returns null`() {
        assertEquals(null, OrderStateMachine.getTimestampField(OrderStatus.REJECTED))
    }

    @Test
    fun `getTimestampField for CANCELLED returns null`() {
        assertEquals(null, OrderStateMachine.getTimestampField(OrderStatus.CANCELLED))
    }
}
