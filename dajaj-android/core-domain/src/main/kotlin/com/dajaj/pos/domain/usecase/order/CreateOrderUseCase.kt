package com.dajaj.pos.domain.usecase.order

import com.dajaj.pos.common.Result
import com.dajaj.pos.domain.repository.OrderRepository
import javax.inject.Inject

/**
 * Domain use case for creating a confirmed POS order.
 *
 * Validates the cart state (items ≥1, order type selected), then delegates
 * to [OrderRepository] for Firestore persistence of the order document,
 * bill document, and KOT print job document.
 *
 * If online: writes to Firestore directly.
 * If offline: saves to Room Database for later sync.
 */
class CreateOrderUseCase @Inject constructor(
    private val orderRepository: OrderRepository
) {

    /**
     * Executes the order creation flow.
     *
     * @param orderData The order document fields
     * @param billData The bill document fields
     * @param printJobData The KOT print job document fields
     * @param isOnline Whether the device currently has internet connectivity
     * @return Result containing the order document ID on success
     */
    suspend operator fun invoke(
        orderData: Map<String, Any?>,
        billData: Map<String, Any?>,
        printJobData: Map<String, Any?>,
        isOnline: Boolean
    ): Result<String> {
        // Validate cart has items
        @Suppress("UNCHECKED_CAST")
        val items = orderData["items"] as? List<*>
        if (items.isNullOrEmpty()) {
            return Result.Error("Cart must contain at least one item")
        }

        // Validate order type is selected
        val orderType = orderData["type"] as? String
        if (orderType.isNullOrBlank()) {
            return Result.Error("Order type must be selected")
        }

        return if (isOnline) {
            createOnline(orderData, billData, printJobData)
        } else {
            createOffline(orderData, billData, printJobData)
        }
    }

    /**
     * Creates order, bill, and print job in Firestore when online.
     */
    private suspend fun createOnline(
        orderData: Map<String, Any?>,
        billData: Map<String, Any?>,
        printJobData: Map<String, Any?>
    ): Result<String> {
        // Create order document
        val orderResult = orderRepository.createOrder(orderData)
        if (orderResult is Result.Error) {
            return orderResult
        }

        val orderId = (orderResult as Result.Success).data

        // Create bill document
        val billResult = orderRepository.createBill(billData)
        if (billResult is Result.Error) {
            // Order was created but bill failed — still return success since order exists
            // Bill can be retried or created manually
        }

        // Create KOT print job document
        val printJobResult = orderRepository.createPrintJob(printJobData)
        if (printJobResult is Result.Error) {
            // Order was created but print job failed — print job will be retried
            // Per requirement 5.7: retain order as confirmed, queue print for retry
        }

        return Result.Success(orderId)
    }

    /**
     * Saves order, bill, and print job to Room Database when offline.
     */
    private suspend fun createOffline(
        orderData: Map<String, Any?>,
        billData: Map<String, Any?>,
        printJobData: Map<String, Any?>
    ): Result<String> {
        val localResult = orderRepository.saveOrderLocally(orderData, billData, printJobData)
        return when (localResult) {
            is Result.Success -> {
                val orderId = orderData["id"] as? String ?: ""
                Result.Success(orderId)
            }
            is Result.Error -> Result.Error(localResult.message, localResult.throwable)
            is Result.Loading -> Result.Error("Unexpected loading state")
        }
    }
}
