package com.dajaj.pos.domain.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit tests for [DomainError] sealed class verifying:
 * - All subtypes produce correct user-facing messages via [DomainError.toUserMessage]
 * - Messages contain no stack traces, exception class names, or internal codes
 * - [DomainErrorExtensions] correctly bridge to [Result.Error]
 */
class DomainErrorTest {

    // --- Network errors ---

    @Test
    fun `NetworkUnavailable message includes the action`() {
        val error = DomainError.NetworkUnavailable("save order")
        assertEquals(
            "Unable to save order. Check your internet connection and try again.",
            error.toUserMessage()
        )
    }

    @Test
    fun `FirestoreTimeout message is generic without internals`() {
        val error = DomainError.FirestoreTimeout("createOrder", 30000L)
        assertEquals("The operation timed out. Please try again.", error.toUserMessage())
    }

    @Test
    fun `FirestorePermissionDenied message is user friendly`() {
        val error = DomainError.FirestorePermissionDenied("orders")
        assertEquals(
            "You don't have permission to perform this action.",
            error.toUserMessage()
        )
    }

    // --- Bluetooth / Printer errors ---

    @Test
    fun `PrinterDisconnected message includes printer name`() {
        val error = DomainError.PrinterDisconnected("Kitchen Printer")
        assertEquals(
            "Printer 'Kitchen Printer' is disconnected. The print job has been queued.",
            error.toUserMessage()
        )
    }

    @Test
    fun `PrintTimeout message mentions automatic retry`() {
        val error = DomainError.PrintTimeout("job_123")
        assertEquals(
            "Print operation timed out. The job will be retried automatically.",
            error.toUserMessage()
        )
    }

    @Test
    fun `PrinterNotFound message includes scan duration`() {
        val error = DomainError.PrinterNotFound(15)
        assertEquals(
            "No printers found after 15s. Check printer is powered on.",
            error.toUserMessage()
        )
    }

    // --- Validation errors ---

    @Test
    fun `InvalidInput message shows field and reason`() {
        val error = DomainError.InvalidInput("phone", "Must be 10 digits")
        assertEquals("phone: Must be 10 digits", error.toUserMessage())
    }

    @Test
    fun `StateTransitionDenied message shows from and to states`() {
        val error = DomainError.StateTransitionDenied("PENDING", "READY")
        assertEquals("Cannot move order from PENDING to READY.", error.toUserMessage())
    }

    @Test
    fun `CapacityExceeded message shows resource and limit`() {
        val error = DomainError.CapacityExceeded("Offline orders", 500)
        assertEquals(
            "Offline orders storage is full (500 limit reached). Please sync or free space.",
            error.toUserMessage()
        )
    }

    // --- Concurrency errors ---

    @Test
    fun `TransactionConflict message shows custom message`() {
        val error = DomainError.TransactionConflict(
            "order_456",
            "Order was already accepted by another cashier."
        )
        assertEquals(
            "Order was already accepted by another cashier.",
            error.toUserMessage()
        )
    }

    // --- Generic ---

    @Test
    fun `Unexpected message is generic without exposing cause details`() {
        val cause = RuntimeException("NullPointerException at line 42")
        val error = DomainError.Unexpected(cause)
        assertEquals("An unexpected error occurred. Please try again.", error.toUserMessage())
    }

    @Test
    fun `Unexpected error preserves original cause`() {
        val cause = IllegalStateException("test")
        val error = DomainError.Unexpected(cause)
        assertEquals(cause, error.cause)
    }

    // --- Verify messages do NOT leak internals ---

    @Test
    fun `no user message contains Exception or Error class names`() {
        val allErrors = listOf(
            DomainError.NetworkUnavailable("sync"),
            DomainError.FirestoreTimeout("read", 5000L),
            DomainError.FirestorePermissionDenied("bills"),
            DomainError.PrinterDisconnected("Printer A"),
            DomainError.PrintTimeout("j1"),
            DomainError.PrinterNotFound(10),
            DomainError.InvalidInput("name", "required"),
            DomainError.StateTransitionDenied("A", "B"),
            DomainError.CapacityExceeded("queue", 100),
            DomainError.TransactionConflict("o1", "conflict"),
            DomainError.Unexpected(RuntimeException("crash"))
        )

        for (error in allErrors) {
            val msg = error.toUserMessage()
            assertTrue(
                "Message should not contain 'Exception': $msg",
                !msg.contains("Exception")
            )
            assertTrue(
                "Message should not contain 'stack trace': $msg",
                !msg.contains("stack trace", ignoreCase = true)
            )
        }
    }

    // --- DomainError to Result conversion ---

    @Test
    fun `toResult creates Result Error with user message`() {
        val domainError = DomainError.NetworkUnavailable("fetch menu")
        val result = domainError.toResult<Unit>()

        assertTrue(result.isError)
        assertEquals(
            "Unable to fetch menu. Check your internet connection and try again.",
            result.errorMessageOrNull()
        )
    }

    @Test
    fun `DomainException wraps DomainError correctly`() {
        val domainError = DomainError.PrinterDisconnected("Bill Printer")
        val exception = DomainException(domainError)

        assertEquals(domainError, exception.domainError)
        assertEquals(domainError.toUserMessage(), exception.message)
        assertNotNull(exception.toString())
    }

    @Test
    fun `domainError extension extracts DomainError from Result Error`() {
        val domainError = DomainError.FirestoreTimeout("save", 10000L)
        val exception = DomainException(domainError)
        val result = com.dajaj.pos.common.Result.Error(
            message = domainError.toUserMessage(),
            throwable = exception
        )

        val extracted = result.domainError()
        assertEquals(domainError, extracted)
    }

    @Test
    fun `domainError extension returns null for non-DomainException`() {
        val result = com.dajaj.pos.common.Result.Error(
            message = "some error",
            throwable = RuntimeException("generic")
        )

        val extracted = result.domainError()
        assertEquals(null, extracted)
    }
}
