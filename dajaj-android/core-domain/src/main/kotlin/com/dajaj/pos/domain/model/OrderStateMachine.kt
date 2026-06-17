package com.dajaj.pos.domain.model

/**
 * Enforces valid order state transitions for the Dajaj kitchen workflow.
 *
 * The state machine ensures all orders—regardless of source channel—follow
 * the same progression:
 *
 * ```
 * PENDING → ACCEPTED → PREPARING → READY → COMPLETED
 * ```
 *
 * Additional allowed transitions:
 * - PENDING → REJECTED
 * - PENDING → CANCELLED
 * - ACCEPTED → CANCELLED
 * - PREPARING → CANCELLED
 * - READY → CANCELLED
 *
 * Skipping states is not permitted. Invalid transitions are rejected and
 * the current state is retained.
 */
class OrderStateMachine {

    companion object {
        /**
         * Map of each status to the set of statuses it can transition to.
         */
        private val validTransitions: Map<OrderStatus, Set<OrderStatus>> = mapOf(
            OrderStatus.PENDING to setOf(
                OrderStatus.ACCEPTED,
                OrderStatus.REJECTED,
                OrderStatus.CANCELLED
            ),
            OrderStatus.ACCEPTED to setOf(
                OrderStatus.PREPARING,
                OrderStatus.CANCELLED
            ),
            OrderStatus.PREPARING to setOf(
                OrderStatus.READY,
                OrderStatus.CANCELLED
            ),
            OrderStatus.READY to setOf(
                OrderStatus.COMPLETED,
                OrderStatus.CANCELLED
            ),
            // Terminal states — no outgoing transitions
            OrderStatus.COMPLETED to emptySet(),
            OrderStatus.CANCELLED to emptySet(),
            OrderStatus.REJECTED to emptySet()
        )

        /**
         * Maps each target status to its corresponding Firestore timestamp field name.
         *
         * Returns `null` for statuses that do not have a dedicated timestamp field
         * (e.g., PENDING uses `createdAt`, and terminal states REJECTED/CANCELLED
         * do not have dedicated timestamp fields in the order document).
         */
        fun getTimestampField(status: OrderStatus): String? = when (status) {
            OrderStatus.ACCEPTED -> "acceptedAt"
            OrderStatus.PREPARING -> "preparingAt"
            OrderStatus.READY -> "readyAt"
            OrderStatus.COMPLETED -> "completedAt"
            else -> null
        }

        /**
         * Checks if a transition from [currentStatus] to [targetStatus] is allowed.
         */
        fun canTransition(currentStatus: OrderStatus, targetStatus: OrderStatus): Boolean {
            val allowed = validTransitions[currentStatus] ?: emptySet()
            return targetStatus in allowed
        }
    }

    /**
     * Attempts to transition an order from [currentStatus] to [targetStatus].
     *
     * @param currentStatus The current status of the order.
     * @param targetStatus The desired new status.
     * @return [Result.success] with the new status if the transition is valid,
     *         or [Result.failure] with an [IllegalStateException] describing
     *         the invalid transition if it is not permitted.
     */
    fun transition(currentStatus: OrderStatus, targetStatus: OrderStatus): Result<OrderStatus> {
        val allowed = validTransitions[currentStatus] ?: emptySet()
        return if (targetStatus in allowed) {
            Result.success(targetStatus)
        } else {
            Result.failure(
                IllegalStateException(
                    "Invalid order transition: ${currentStatus.toFirestoreValue()} → ${targetStatus.toFirestoreValue()}"
                )
            )
        }
    }
}
