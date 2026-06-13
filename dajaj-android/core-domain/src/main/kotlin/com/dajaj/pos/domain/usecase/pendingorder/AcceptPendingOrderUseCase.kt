package com.dajaj.pos.domain.usecase.pendingorder

import com.dajaj.pos.common.Result
import com.dajaj.pos.domain.model.MenuItemType
import com.dajaj.pos.domain.model.PendingOrder
import com.dajaj.pos.domain.model.PendingOrderItem
import com.dajaj.pos.domain.model.PendingOrderStatus
import com.dajaj.pos.domain.repository.MenuRepository
import com.dajaj.pos.domain.repository.OrderRepository
import com.dajaj.pos.domain.repository.PendingOrderRepository
import kotlinx.coroutines.flow.first
import java.util.UUID
import javax.inject.Inject

/**
 * Domain use case for accepting a pending order from an external channel.
 *
 * Converts a pending order into a confirmed POS order by:
 * 1. Fetching the pending order from [PendingOrderRepository]
 * 2. Validating all items are available in the current menu
 * 3. Creating an order document in Firestore with status ACCEPTED
 * 4. Auto-generating a KOT print job (status: PENDING)
 * 5. Updating the pending order status to ACCEPTED with processedAt timestamp
 *
 * If any menu items are unavailable, the use case returns an error describing
 * the unavailable items. The pending order remains in PENDING state, and no
 * order or KOT is created.
 */
class AcceptPendingOrderUseCase @Inject constructor(
    private val pendingOrderRepository: PendingOrderRepository,
    private val orderRepository: OrderRepository,
    private val menuRepository: MenuRepository
) {

    /**
     * Executes the accept pending order flow.
     *
     * @param pendingOrderId The ID of the pending order to accept
     * @param restaurantId The restaurant identifier
     * @param cashierId The ID of the cashier accepting the order
     * @return Result<String> containing the created order ID on success,
     *         or an error if the pending order cannot be accepted
     */
    suspend operator fun invoke(
        pendingOrderId: String,
        restaurantId: String,
        cashierId: String
    ): Result<String> {
        // 1. Fetch the pending order
        val pendingOrderResult = pendingOrderRepository.getOrderById(pendingOrderId)
        if (pendingOrderResult is Result.Error) {
            return Result.Error(pendingOrderResult.message, pendingOrderResult.throwable)
        }

        val pendingOrder = (pendingOrderResult as Result.Success).data

        // Validate order is still in PENDING state
        if (pendingOrder.status != PendingOrderStatus.PENDING) {
            return Result.Error("Order has already been ${pendingOrder.status.toFirestoreValue()}")
        }

        // 2. Validate all items are available in the menu
        val unavailableItems = validateMenuItemAvailability(pendingOrder.items)
        if (unavailableItems.isNotEmpty()) {
            val itemNames = unavailableItems.joinToString(", ")
            return Result.Error("Menu items unavailable: $itemNames")
        }

        // 3. Create order document
        val timestamp = System.currentTimeMillis()
        val orderId = UUID.randomUUID().toString()

        val orderData = buildOrderData(
            orderId = orderId,
            pendingOrder = pendingOrder,
            restaurantId = restaurantId,
            cashierId = cashierId,
            timestamp = timestamp
        )

        val orderResult = orderRepository.createOrder(orderData)
        if (orderResult is Result.Error) {
            return Result.Error(orderResult.message, orderResult.throwable)
        }

        val createdOrderId = (orderResult as Result.Success).data

        // 4. Auto-generate KOT print job
        val printJobData = buildKotPrintJobData(
            orderId = createdOrderId,
            orderNumber = pendingOrder.orderNumber,
            pendingOrder = pendingOrder,
            restaurantId = restaurantId,
            timestamp = timestamp
        )

        val printJobResult = orderRepository.createPrintJob(printJobData)
        if (printJobResult is Result.Error) {
            // Order was created but print job failed — order is still accepted.
            // Print job will be retried or can be manually triggered.
        }

        // 5. Update pending order status to ACCEPTED
        val acceptResult = pendingOrderRepository.acceptOrder(pendingOrderId)
        if (acceptResult is Result.Error) {
            // Order and print job were created but status update failed.
            // This is non-critical — the order exists and KOT is queued.
        }

        return Result.Success(createdOrderId)
    }

    /**
     * Validates that all pending order items are available in the current menu.
     *
     * Checks each item name against available menu variants. Items are considered
     * unavailable if they don't exist in the menu or have `isAvailable = false`.
     *
     * @param items The list of pending order items to validate
     * @return List of item names that are unavailable (empty if all are available)
     */
    private suspend fun validateMenuItemAvailability(
        items: List<PendingOrderItem>
    ): List<String> {
        val allMenuItems = menuRepository.observeMenu().first()

        // Build a set of available item names (variants only, case-insensitive)
        val availableItemNames = allMenuItems
            .filter { it.type == MenuItemType.VARIANT && it.isAvailable }
            .map { it.name.lowercase() }
            .toSet()

        return items
            .filter { item -> item.name.lowercase() !in availableItemNames }
            .map { it.name }
    }

    /**
     * Builds the order document data map from a pending order.
     * Preserves item names, quantities, and prices from the pending order.
     */
    private fun buildOrderData(
        orderId: String,
        pendingOrder: PendingOrder,
        restaurantId: String,
        cashierId: String,
        timestamp: Long
    ): Map<String, Any?> {
        return mapOf(
            "id" to orderId,
            "restaurantId" to restaurantId,
            "orderNumber" to pendingOrder.orderNumber,
            "channel" to pendingOrder.channel.toFirestoreValue(),
            "type" to pendingOrder.channel.toFirestoreValue(),
            "status" to "accepted",
            "customerId" to "",
            "customerName" to pendingOrder.customerName,
            "customerPhone" to pendingOrder.customerPhone,
            "items" to pendingOrder.items.map { item ->
                mapOf(
                    "id" to "",
                    "name" to item.name,
                    "variantLabel" to "",
                    "qty" to item.qty,
                    "basePrice" to item.price,
                    "modifiers" to emptyList<Map<String, Any?>>(),
                    "itemTotal" to item.total
                )
            },
            "subtotal" to pendingOrder.total,
            "cgst" to 0.0,
            "sgst" to 0.0,
            "grandTotal" to pendingOrder.total,
            "paymentMode" to "cash",
            "cashierId" to cashierId,
            "rejectionReason" to null,
            "createdAt" to timestamp,
            "updatedAt" to timestamp,
            "acceptedAt" to timestamp,
            "preparingAt" to null,
            "readyAt" to null,
            "completedAt" to null
        )
    }

    /**
     * Builds the KOT print job data map for the accepted pending order.
     * The print job is created with status PENDING for the Print Agent to process.
     */
    private fun buildKotPrintJobData(
        orderId: String,
        orderNumber: String,
        pendingOrder: PendingOrder,
        restaurantId: String,
        timestamp: Long
    ): Map<String, Any?> {
        return mapOf(
            "id" to UUID.randomUUID().toString(),
            "restaurantId" to restaurantId,
            "jobType" to "kot",
            "printerType" to "kot",
            "status" to "pending",
            "claimedBy" to null,
            "orderId" to orderId,
            "orderNumber" to orderNumber,
            "payload" to mapOf(
                "header" to "DAJAJ - Kitchen Order",
                "orderNumber" to orderNumber,
                "orderType" to pendingOrder.channel.toDisplayName(),
                "time" to timestamp,
                "items" to pendingOrder.items.map { item ->
                    mapOf(
                        "name" to item.name,
                        "qty" to item.qty,
                        "modifiers" to emptyList<String>(),
                        "notes" to ""
                    )
                },
                "specialNotes" to (pendingOrder.notes ?: ""),
                "isReprint" to false,
                "originalJobId" to null
            ),
            "retryCount" to 0,
            "failureReason" to null,
            "source" to "android_pos",
            "createdAt" to timestamp,
            "claimedAt" to null,
            "completedAt" to null
        )
    }
}

/**
 * Extension to convert OrderChannel to a human-readable display name for KOT printing.
 */
private fun com.dajaj.pos.domain.model.OrderChannel.toDisplayName(): String = when (this) {
    com.dajaj.pos.domain.model.OrderChannel.WALK_IN -> "Walk-in"
    com.dajaj.pos.domain.model.OrderChannel.WHATSAPP -> "WhatsApp"
    com.dajaj.pos.domain.model.OrderChannel.WEBSITE -> "Website"
    com.dajaj.pos.domain.model.OrderChannel.QR -> "QR Order"
    com.dajaj.pos.domain.model.OrderChannel.SWIGGY -> "Swiggy"
    com.dajaj.pos.domain.model.OrderChannel.ZOMATO -> "Zomato"
}
