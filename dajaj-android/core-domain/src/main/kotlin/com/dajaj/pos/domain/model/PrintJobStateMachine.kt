package com.dajaj.pos.domain.model

/**
 * Enforces valid print job state transitions for the Dajaj print queue.
 *
 * The state machine ensures print jobs follow this strict lifecycle:
 *
 * ```
 * PENDING → PROCESSING (agent claims job via Firestore transaction)
 * PROCESSING → COMPLETED (print success)
 * PROCESSING → FAILED (3 retries exhausted)
 * FAILED → PENDING (manual retry only, resets retryCount)
 * ```
 *
 * Terminal state: COMPLETED (no outgoing transitions).
 * Non-terminal FAILED can only transition back to PENDING via manual retry.
 * All other transitions are rejected.
 */
object PrintJobStateMachine {

    /**
     * Map of each status to the set of statuses it can transition to.
     */
    private val validTransitions: Map<PrintJobStatus, Set<PrintJobStatus>> = mapOf(
        PrintJobStatus.PENDING to setOf(PrintJobStatus.PROCESSING),
        PrintJobStatus.PROCESSING to setOf(PrintJobStatus.COMPLETED, PrintJobStatus.FAILED),
        PrintJobStatus.COMPLETED to emptySet(),
        PrintJobStatus.FAILED to setOf(PrintJobStatus.PENDING)
    )

    /**
     * Returns whether transitioning from [from] to [to] is permitted
     * by the print job state machine.
     *
     * @param from The current status of the print job.
     * @param to The desired target status.
     * @return `true` if the transition is valid, `false` otherwise.
     */
    fun canTransition(from: PrintJobStatus, to: PrintJobStatus): Boolean {
        val allowed = validTransitions[from] ?: emptySet()
        return to in allowed
    }

    /**
     * Attempts to transition a print job from [from] to [to].
     *
     * @param from The current status of the print job.
     * @param to The desired new status.
     * @return [Result.success] with the new status if the transition is valid,
     *         or [Result.failure] with an [IllegalStateException] describing
     *         the invalid transition if it is not permitted.
     */
    fun transition(from: PrintJobStatus, to: PrintJobStatus): Result<PrintJobStatus> {
        return if (canTransition(from, to)) {
            Result.success(to)
        } else {
            Result.failure(
                IllegalStateException(
                    "Invalid print job transition: ${from.toFirestoreValue()} → ${to.toFirestoreValue()}"
                )
            )
        }
    }

    /**
     * Returns the set of statuses that are valid transition targets
     * from the given [from] status.
     *
     * @param from The current status to query valid transitions for.
     * @return A set of valid target statuses (may be empty for terminal states).
     */
    fun getValidTransitions(from: PrintJobStatus): Set<PrintJobStatus> {
        return validTransitions[from] ?: emptySet()
    }
}
