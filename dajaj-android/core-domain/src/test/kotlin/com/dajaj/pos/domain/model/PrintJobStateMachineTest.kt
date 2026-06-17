package com.dajaj.pos.domain.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PrintJobStateMachineTest {

    // --- Valid transitions ---

    @Test
    fun `PENDING to PROCESSING is valid`() {
        val result = PrintJobStateMachine.transition(PrintJobStatus.PENDING, PrintJobStatus.PROCESSING)
        assertTrue(result.isSuccess)
        assertEquals(PrintJobStatus.PROCESSING, result.getOrNull())
    }

    @Test
    fun `PROCESSING to COMPLETED is valid`() {
        val result = PrintJobStateMachine.transition(PrintJobStatus.PROCESSING, PrintJobStatus.COMPLETED)
        assertTrue(result.isSuccess)
        assertEquals(PrintJobStatus.COMPLETED, result.getOrNull())
    }

    @Test
    fun `PROCESSING to FAILED is valid`() {
        val result = PrintJobStateMachine.transition(PrintJobStatus.PROCESSING, PrintJobStatus.FAILED)
        assertTrue(result.isSuccess)
        assertEquals(PrintJobStatus.FAILED, result.getOrNull())
    }

    @Test
    fun `FAILED to PENDING is valid - manual retry`() {
        val result = PrintJobStateMachine.transition(PrintJobStatus.FAILED, PrintJobStatus.PENDING)
        assertTrue(result.isSuccess)
        assertEquals(PrintJobStatus.PENDING, result.getOrNull())
    }

    // --- canTransition matches transition ---

    @Test
    fun `canTransition returns true for valid transitions`() {
        assertTrue(PrintJobStateMachine.canTransition(PrintJobStatus.PENDING, PrintJobStatus.PROCESSING))
        assertTrue(PrintJobStateMachine.canTransition(PrintJobStatus.PROCESSING, PrintJobStatus.COMPLETED))
        assertTrue(PrintJobStateMachine.canTransition(PrintJobStatus.PROCESSING, PrintJobStatus.FAILED))
        assertTrue(PrintJobStateMachine.canTransition(PrintJobStatus.FAILED, PrintJobStatus.PENDING))
    }

    @Test
    fun `canTransition returns false for invalid transitions`() {
        assertFalse(PrintJobStateMachine.canTransition(PrintJobStatus.PENDING, PrintJobStatus.COMPLETED))
        assertFalse(PrintJobStateMachine.canTransition(PrintJobStatus.PENDING, PrintJobStatus.FAILED))
        assertFalse(PrintJobStateMachine.canTransition(PrintJobStatus.COMPLETED, PrintJobStatus.PENDING))
        assertFalse(PrintJobStateMachine.canTransition(PrintJobStatus.FAILED, PrintJobStatus.PROCESSING))
    }

    // --- Terminal state: COMPLETED has no outgoing transitions ---

    @Test
    fun `COMPLETED to any state is invalid`() {
        PrintJobStatus.values().forEach { target ->
            val result = PrintJobStateMachine.transition(PrintJobStatus.COMPLETED, target)
            assertTrue(
                "COMPLETED should not transition to ${target.toFirestoreValue()}",
                result.isFailure
            )
        }
    }

    // --- FAILED can only go to PENDING ---

    @Test
    fun `FAILED to PROCESSING is invalid`() {
        val result = PrintJobStateMachine.transition(PrintJobStatus.FAILED, PrintJobStatus.PROCESSING)
        assertTrue(result.isFailure)
    }

    @Test
    fun `FAILED to COMPLETED is invalid`() {
        val result = PrintJobStateMachine.transition(PrintJobStatus.FAILED, PrintJobStatus.COMPLETED)
        assertTrue(result.isFailure)
    }

    @Test
    fun `FAILED to FAILED is invalid - no self transition`() {
        val result = PrintJobStateMachine.transition(PrintJobStatus.FAILED, PrintJobStatus.FAILED)
        assertTrue(result.isFailure)
    }

    // --- PENDING can only go to PROCESSING ---

    @Test
    fun `PENDING to COMPLETED is invalid`() {
        val result = PrintJobStateMachine.transition(PrintJobStatus.PENDING, PrintJobStatus.COMPLETED)
        assertTrue(result.isFailure)
    }

    @Test
    fun `PENDING to FAILED is invalid`() {
        val result = PrintJobStateMachine.transition(PrintJobStatus.PENDING, PrintJobStatus.FAILED)
        assertTrue(result.isFailure)
    }

    // --- PROCESSING cannot go to PENDING ---

    @Test
    fun `PROCESSING to PENDING is invalid`() {
        val result = PrintJobStateMachine.transition(PrintJobStatus.PROCESSING, PrintJobStatus.PENDING)
        assertTrue(result.isFailure)
    }

    // --- Self-transitions are invalid for all states ---

    @Test
    fun `self-transition is invalid for all states`() {
        PrintJobStatus.values().forEach { status ->
            val result = PrintJobStateMachine.transition(status, status)
            assertTrue(
                "${status.toFirestoreValue()} should not transition to itself",
                result.isFailure
            )
        }
    }

    // --- getValidTransitions ---

    @Test
    fun `getValidTransitions for PENDING returns PROCESSING only`() {
        assertEquals(setOf(PrintJobStatus.PROCESSING), PrintJobStateMachine.getValidTransitions(PrintJobStatus.PENDING))
    }

    @Test
    fun `getValidTransitions for PROCESSING returns COMPLETED and FAILED`() {
        assertEquals(
            setOf(PrintJobStatus.COMPLETED, PrintJobStatus.FAILED),
            PrintJobStateMachine.getValidTransitions(PrintJobStatus.PROCESSING)
        )
    }

    @Test
    fun `getValidTransitions for COMPLETED returns empty set`() {
        assertEquals(emptySet<PrintJobStatus>(), PrintJobStateMachine.getValidTransitions(PrintJobStatus.COMPLETED))
    }

    @Test
    fun `getValidTransitions for FAILED returns PENDING only`() {
        assertEquals(setOf(PrintJobStatus.PENDING), PrintJobStateMachine.getValidTransitions(PrintJobStatus.FAILED))
    }

    // --- Error message format ---

    @Test
    fun `invalid transition error message includes both states`() {
        val result = PrintJobStateMachine.transition(PrintJobStatus.COMPLETED, PrintJobStatus.PENDING)
        assertTrue(result.isFailure)
        val message = result.exceptionOrNull()?.message ?: ""
        assertTrue(message.contains("completed"))
        assertTrue(message.contains("pending"))
    }
}
