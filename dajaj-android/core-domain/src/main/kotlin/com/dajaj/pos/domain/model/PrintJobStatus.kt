package com.dajaj.pos.domain.model

/**
 * Represents the lifecycle status of a print job in the queue.
 *
 * Valid transitions:
 * - PENDING → PROCESSING (agent claims the job)
 * - PROCESSING → COMPLETED (print succeeded)
 * - PROCESSING → FAILED (all retries exhausted)
 * - FAILED → PENDING (manual retry by cashier)
 */
enum class PrintJobStatus {
    /** Job created, waiting for an agent to claim it. */
    PENDING,

    /** Job claimed by a print agent and being sent to the printer. */
    PROCESSING,

    /** Job printed successfully. */
    COMPLETED,

    /** Job failed after all retry attempts were exhausted. */
    FAILED;

    companion object {
        fun fromString(value: String): PrintJobStatus = when (value.lowercase()) {
            "pending" -> PENDING
            "processing" -> PROCESSING
            "completed" -> COMPLETED
            "failed" -> FAILED
            else -> PENDING
        }

        /**
         * Returns the set of statuses that are valid targets from the given [from] status.
         */
        fun validTransitions(from: PrintJobStatus): Set<PrintJobStatus> = when (from) {
            PENDING -> setOf(PROCESSING)
            PROCESSING -> setOf(COMPLETED, FAILED)
            COMPLETED -> emptySet()
            FAILED -> setOf(PENDING)
        }
    }

    fun toFirestoreValue(): String = when (this) {
        PENDING -> "pending"
        PROCESSING -> "processing"
        COMPLETED -> "completed"
        FAILED -> "failed"
    }

    /**
     * Returns `true` if transitioning from this status to [target] is valid
     * according to the print job state machine.
     */
    fun canTransitionTo(target: PrintJobStatus): Boolean =
        target in validTransitions(this)
}
