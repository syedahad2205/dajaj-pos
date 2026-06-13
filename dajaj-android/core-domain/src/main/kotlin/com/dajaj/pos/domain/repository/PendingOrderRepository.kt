package com.dajaj.pos.domain.repository

import com.dajaj.pos.common.Result
import com.dajaj.pos.domain.model.PendingOrder
import kotlinx.coroutines.flow.Flow

/**
 * Repository interface for pending order operations.
 *
 * Provides real-time observation of incoming orders from external channels
 * and actions to accept or reject them from the cashier interface.
 */
interface PendingOrderRepository {

    /**
     * Observes pending orders for a given restaurant as a reactive [Flow].
     * Orders are sorted by creation timestamp ascending (oldest first).
     *
     * @param restaurantId The restaurant to observe pending orders for
     * @return Flow emitting the current list of pending orders in real-time
     */
    fun observePendingOrders(restaurantId: String): Flow<List<PendingOrder>>

    /**
     * Accepts a pending order, transitioning it to ACCEPTED status.
     * The implementation should update the status and set the processedAt timestamp.
     *
     * @param orderId The ID of the pending order to accept
     * @return Result indicating success or failure of the operation
     */
    suspend fun acceptOrder(orderId: String): Result<Unit>

    /**
     * Rejects a pending order with a reason, transitioning it to REJECTED status.
     * The rejection reason must be between 1 and 200 characters.
     *
     * @param orderId The ID of the pending order to reject
     * @param reason The reason for rejection (1–200 characters)
     * @return Result indicating success or failure of the operation
     */
    suspend fun rejectOrder(orderId: String, reason: String): Result<Unit>

    /**
     * Retrieves a single pending order by its ID.
     *
     * @param orderId The ID of the pending order to retrieve
     * @return Result containing the pending order if found, or an error
     */
    suspend fun getOrderById(orderId: String): Result<PendingOrder>
}
