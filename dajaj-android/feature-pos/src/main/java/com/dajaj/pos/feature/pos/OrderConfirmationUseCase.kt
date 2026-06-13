package com.dajaj.pos.feature.pos

import com.dajaj.pos.common.Result
import com.dajaj.pos.common.network.ConnectivityMonitor
import com.dajaj.pos.data.remote.CounterService
import com.dajaj.pos.domain.usecase.order.CreateOrderUseCase
import com.dajaj.pos.feature.pos.model.CartItem
import com.dajaj.pos.feature.pos.model.CartState
import com.dajaj.pos.feature.pos.model.OrderConfirmationResult
import com.dajaj.pos.feature.pos.model.OrderType
import java.util.UUID
import javax.inject.Inject

/**
 * Use case orchestrating the full order confirmation flow for the POS screen.
 *
 * Takes a [CartState] as input and:
 * 1. Generates an order number via [CounterService.getNextOrderNumber]
 * 2. Generates an order label via [CounterService.generateOrderLabel]
 * 3. Generates a bill number via [CounterService.getNextBillNumber]
 * 4. Creates an order document in Firestore `orders` collection
 * 5. Creates a bill document in Firestore `bills` collection
 * 6. Creates a KOT print job in Firestore `print_jobs` collection
 *
 * If offline: saves order and print job to Room local_orders and local_print_queue tables.
 *
 * @return [Result]<[OrderConfirmationResult]> with order number, bill number, and order ID
 */
class OrderConfirmationUseCase @Inject constructor(
    private val counterService: CounterService,
    private val createOrderUseCase: CreateOrderUseCase,
    private val connectivityMonitor: ConnectivityMonitor
) {

    /**
     * Confirms the order from the given cart state.
     *
     * @param cartState The current cart state with items, order type, and totals
     * @param restaurantId The restaurant identifier
     * @param cashierId The ID of the cashier processing the order
     * @return Result containing [OrderConfirmationResult] on success
     */
    suspend operator fun invoke(
        cartState: CartState,
        restaurantId: String,
        cashierId: String
    ): Result<OrderConfirmationResult> {
        // Validate prerequisites
        if (cartState.items.isEmpty()) {
            return Result.Error("Cart is empty")
        }
        if (cartState.orderType == null) {
            return Result.Error("Order type must be selected")
        }

        val isOnline = connectivityMonitor.isCurrentlyConnected()
        val timestamp = System.currentTimeMillis()

        // Generate sequential numbers
        val orderNumber: Long
        val billNumber: String
        val orderLabel: String

        try {
            orderNumber = counterService.getNextOrderNumber()
            billNumber = counterService.getNextBillNumber()
            orderLabel = counterService.generateOrderLabel(timestamp)
        } catch (e: Exception) {
            // If counter service fails (offline or transaction failure),
            // generate fallback local IDs
            if (!isOnline) {
                return confirmOffline(cartState, restaurantId, cashierId, timestamp)
            }
            return Result.Error("Failed to generate order number: ${e.message}", e)
        }

        val orderId = orderNumber.toString()

        // Build order document
        val orderData = buildOrderData(
            orderId = orderId,
            orderNumber = orderLabel,
            cartState = cartState,
            restaurantId = restaurantId,
            cashierId = cashierId,
            timestamp = timestamp
        )

        // Build bill document
        val billId = UUID.randomUUID().toString()
        val billData = buildBillData(
            billId = billId,
            billNumber = billNumber,
            orderNumber = orderLabel,
            cartState = cartState,
            restaurantId = restaurantId,
            cashierId = cashierId,
            timestamp = timestamp
        )

        // Build KOT print job document
        val printJobId = UUID.randomUUID().toString()
        val printJobData = buildPrintJobData(
            printJobId = printJobId,
            orderId = orderId,
            orderNumber = orderLabel,
            cartState = cartState,
            restaurantId = restaurantId,
            timestamp = timestamp
        )

        // Delegate to CreateOrderUseCase for persistence
        val result = createOrderUseCase(
            orderData = orderData,
            billData = billData,
            printJobData = printJobData,
            isOnline = isOnline
        )

        return when (result) {
            is Result.Success -> Result.Success(
                OrderConfirmationResult(
                    orderNumber = orderLabel,
                    billNumber = billNumber,
                    orderId = result.data
                )
            )
            is Result.Error -> Result.Error(result.message, result.throwable)
            is Result.Loading -> Result.Error("Unexpected loading state")
        }
    }

    /**
     * Handles order confirmation when device is offline.
     * Generates local fallback IDs and saves to Room.
     */
    private suspend fun confirmOffline(
        cartState: CartState,
        restaurantId: String,
        cashierId: String,
        timestamp: Long
    ): Result<OrderConfirmationResult> {
        val localOrderId = "local_${UUID.randomUUID()}"
        val localBillNumber = "LOCAL-${timestamp}"
        val orderLabel = cartState.orderLabel.ifEmpty { "OFFLINE-${timestamp}" }

        val orderData = buildOrderData(
            orderId = localOrderId,
            orderNumber = orderLabel,
            cartState = cartState,
            restaurantId = restaurantId,
            cashierId = cashierId,
            timestamp = timestamp
        )

        val billData = buildBillData(
            billId = UUID.randomUUID().toString(),
            billNumber = localBillNumber,
            orderNumber = orderLabel,
            cartState = cartState,
            restaurantId = restaurantId,
            cashierId = cashierId,
            timestamp = timestamp
        )

        val printJobId = UUID.randomUUID().toString()
        val printJobData = buildPrintJobData(
            printJobId = printJobId,
            orderId = localOrderId,
            orderNumber = orderLabel,
            cartState = cartState,
            restaurantId = restaurantId,
            timestamp = timestamp
        )

        val result = createOrderUseCase(
            orderData = orderData,
            billData = billData,
            printJobData = printJobData,
            isOnline = false
        )

        return when (result) {
            is Result.Success -> Result.Success(
                OrderConfirmationResult(
                    orderNumber = orderLabel,
                    billNumber = localBillNumber,
                    orderId = localOrderId
                )
            )
            is Result.Error -> Result.Error(result.message, result.throwable)
            is Result.Loading -> Result.Error("Unexpected loading state")
        }
    }

    /**
     * Builds the order document data map for Firestore.
     */
    private fun buildOrderData(
        orderId: String,
        orderNumber: String,
        cartState: CartState,
        restaurantId: String,
        cashierId: String,
        timestamp: Long
    ): Map<String, Any?> {
        return mapOf(
            "id" to orderId,
            "restaurantId" to restaurantId,
            "orderNumber" to orderNumber,
            "channel" to "walk_in",
            "type" to cartState.orderType!!.toFirestoreValue(),
            "status" to "accepted",
            "customerId" to "",
            "customerName" to getCustomerName(cartState.orderType),
            "customerPhone" to "",
            "items" to cartState.items.map { it.toOrderItemMap() },
            "subtotal" to cartState.subtotal,
            "cgst" to cartState.cgst,
            "sgst" to cartState.sgst,
            "grandTotal" to cartState.grandTotal,
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
     * Builds the bill document data map for Firestore.
     */
    private fun buildBillData(
        billId: String,
        billNumber: String,
        orderNumber: String,
        cartState: CartState,
        restaurantId: String,
        cashierId: String,
        timestamp: Long
    ): Map<String, Any?> {
        return mapOf(
            "id" to billId,
            "billNo" to billNumber,
            "publicToken" to UUID.randomUUID().toString(),
            "restaurantId" to restaurantId,
            "orderNumber" to orderNumber,
            "orderType" to cartState.orderType!!.toFirestoreValue(),
            "channel" to "walk_in",
            "items" to cartState.items.map { it.toBillItemMap() },
            "subtotal" to cartState.subtotal,
            "cgst" to cartState.cgst,
            "sgst" to cartState.sgst,
            "grandTotal" to cartState.grandTotal,
            "paymentMode" to "cash",
            "cashCollected" to cartState.grandTotal,
            "punchedBy" to cashierId,
            "customer" to mapOf(
                "name" to getCustomerName(cartState.orderType),
                "phone" to ""
            ),
            "createdAt" to timestamp
        )
    }

    /**
     * Builds the KOT print job document data map for Firestore.
     */
    private fun buildPrintJobData(
        printJobId: String,
        orderId: String,
        orderNumber: String,
        cartState: CartState,
        restaurantId: String,
        timestamp: Long
    ): Map<String, Any?> {
        return mapOf(
            "id" to printJobId,
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
                "orderType" to cartState.orderType!!.toDisplayName(),
                "time" to timestamp,
                "items" to cartState.items.map { item ->
                    mapOf(
                        "name" to item.menuItem.name,
                        "qty" to item.quantity,
                        "modifiers" to item.modifiers.map { mod ->
                            mapOf("name" to mod.name, "groupName" to mod.groupName)
                        }
                    )
                },
                "notes" to ""
            ),
            "retryCount" to 0,
            "failureReason" to null,
            "source" to "android_pos",
            "createdAt" to timestamp,
            "claimedAt" to null,
            "completedAt" to null
        )
    }

    /**
     * Returns the default customer name based on order type.
     */
    private fun getCustomerName(orderType: OrderType?): String {
        return when (orderType) {
            OrderType.WALK_IN -> "Walk-in Customer"
            OrderType.TAKEAWAY -> "Takeaway Customer"
            OrderType.DINE_IN -> "Dine-in Customer"
            null -> "Customer"
        }
    }
}

/**
 * Extension to convert OrderType to Firestore field value.
 */
private fun OrderType.toFirestoreValue(): String = when (this) {
    OrderType.WALK_IN -> "walk_in"
    OrderType.TAKEAWAY -> "takeaway"
    OrderType.DINE_IN -> "dine_in"
}

/**
 * Extension to convert OrderType to display name for KOT printing.
 */
private fun OrderType.toDisplayName(): String = when (this) {
    OrderType.WALK_IN -> "Walk-in"
    OrderType.TAKEAWAY -> "Takeaway"
    OrderType.DINE_IN -> "Dine-in"
}

/**
 * Extension to convert CartItem to order item map for Firestore.
 */
private fun CartItem.toOrderItemMap(): Map<String, Any?> = mapOf(
    "id" to menuItem.id,
    "name" to menuItem.name,
    "variantLabel" to (menuItem.variantLabel ?: ""),
    "qty" to quantity,
    "basePrice" to menuItem.price.toDouble(),
    "modifiers" to modifiers.map { mod ->
        mapOf(
            "id" to mod.id,
            "name" to mod.name,
            "price" to mod.price,
            "groupName" to mod.groupName
        )
    },
    "itemTotal" to lineTotal
)

/**
 * Extension to convert CartItem to bill item map for Firestore.
 */
private fun CartItem.toBillItemMap(): Map<String, Any?> = mapOf(
    "name" to menuItem.name,
    "variantLabel" to (menuItem.variantLabel ?: ""),
    "qty" to quantity,
    "price" to menuItem.price.toDouble(),
    "modifiers" to modifiers.map { mod ->
        mapOf("name" to mod.name, "price" to mod.price)
    },
    "total" to lineTotal
)
