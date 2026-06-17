package com.dajaj.pos.domain.model

/**
 * Structured error types for the domain layer.
 *
 * All Firestore and Bluetooth exceptions are mapped to a specific [DomainError] subtype,
 * ensuring no unhandled exception crashes the application. Each subtype provides a
 * user-friendly message via [toUserMessage] that describes the failed action and available
 * recovery options without exposing stack traces, exception class names, or internal error codes.
 *
 * @see <a href="requirements.md">Requirement 18.3</a>
 */
sealed class DomainError {

    // --- Network errors ---

    /**
     * The device has no internet connectivity and cannot perform [action].
     */
    data class NetworkUnavailable(val action: String) : DomainError()

    /**
     * A Firestore [operation] exceeded the allowed [timeoutMs] duration.
     */
    data class FirestoreTimeout(val operation: String, val timeoutMs: Long) : DomainError()

    /**
     * The current user lacks permission to access the specified Firestore [collection].
     */
    data class FirestorePermissionDenied(val collection: String) : DomainError()

    // --- Bluetooth / Printer errors ---

    /**
     * The Bluetooth printer [printerName] lost connection unexpectedly.
     */
    data class PrinterDisconnected(val printerName: String) : DomainError()

    /**
     * A print job [jobId] did not complete within the allowed timeout.
     */
    data class PrintTimeout(val jobId: String) : DomainError()

    /**
     * No Bluetooth printers were discovered after scanning for [scanDurationSec] seconds.
     */
    data class PrinterNotFound(val scanDurationSec: Int) : DomainError()

    // --- Validation errors ---

    /**
     * Input validation failed for [field] because of [reason].
     */
    data class InvalidInput(val field: String, val reason: String) : DomainError()

    /**
     * An order or print job state transition from [from] to [to] is not permitted.
     */
    data class StateTransitionDenied(val from: String, val to: String) : DomainError()

    /**
     * A local storage [resource] has reached its maximum [limit].
     */
    data class CapacityExceeded(val resource: String, val limit: Int) : DomainError()

    // --- Concurrency errors ---

    /**
     * A Firestore transaction conflict occurred for order [orderId].
     */
    data class TransactionConflict(val orderId: String, val message: String) : DomainError()

    // --- Generic ---

    /**
     * An unexpected/unclassified error. Wraps the original [cause] for logging purposes.
     */
    data class Unexpected(val cause: Throwable) : DomainError()

    // -------------------------------------------------------------------------
    // User-friendly message for UI display.
    // No stack traces, no internal codes — describes the failed action and
    // available recovery options.
    // -------------------------------------------------------------------------

    /**
     * Returns a non-technical, user-facing message describing the error and recovery steps.
     */
    fun toUserMessage(): String = when (this) {
        is NetworkUnavailable ->
            "Unable to $action. Check your internet connection and try again."
        is FirestoreTimeout ->
            "The operation timed out. Please try again."
        is FirestorePermissionDenied ->
            "You don't have permission to perform this action."
        is PrinterDisconnected ->
            "Printer '$printerName' is disconnected. The print job has been queued."
        is PrintTimeout ->
            "Print operation timed out. The job will be retried automatically."
        is PrinterNotFound ->
            "No printers found after ${scanDurationSec}s. Check printer is powered on."
        is InvalidInput ->
            "$field: $reason"
        is StateTransitionDenied ->
            "Cannot move order from $from to $to."
        is CapacityExceeded ->
            "$resource storage is full ($limit limit reached). Please sync or free space."
        is TransactionConflict ->
            message
        is Unexpected ->
            "An unexpected error occurred. Please try again."
    }
}
