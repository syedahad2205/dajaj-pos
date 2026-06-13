package com.dajaj.pos.domain.usecase.pendingorder

import com.dajaj.pos.common.Result
import com.dajaj.pos.domain.repository.PendingOrderRepository
import javax.inject.Inject

/**
 * Domain use case for rejecting a pending order.
 *
 * Validates the rejection reason length (1-200 characters) and delegates
 * to [PendingOrderRepository] to update the pending order status to REJECTED,
 * record the rejection reason, and set the processedAt timestamp.
 */
class RejectPendingOrderUseCase @Inject constructor(
    private val pendingOrderRepository: PendingOrderRepository
) {

    companion object {
        const val REJECTION_REASON_MIN = 1
        const val REJECTION_REASON_MAX = 200
    }

    /**
     * Executes the rejection flow.
     *
     * @param pendingOrderId The ID of the pending order to reject
     * @param rejectionReason The reason for rejection (must be 1-200 characters)
     * @return Result<Unit> indicating success or validation/persistence failure
     */
    suspend operator fun invoke(
        pendingOrderId: String,
        rejectionReason: String
    ): Result<Unit> {
        // Validate rejection reason length
        if (rejectionReason.length < REJECTION_REASON_MIN ||
            rejectionReason.length > REJECTION_REASON_MAX
        ) {
            return Result.Error(
                "Rejection reason must be between $REJECTION_REASON_MIN " +
                    "and $REJECTION_REASON_MAX characters"
            )
        }

        return pendingOrderRepository.rejectOrder(pendingOrderId, rejectionReason)
    }
}
