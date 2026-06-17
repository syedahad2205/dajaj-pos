package com.dajaj.pos.domain.repository

import com.dajaj.pos.common.Result
import com.dajaj.pos.domain.model.OrderChannel
import com.dajaj.pos.domain.model.OrderItem
import com.dajaj.pos.domain.model.OrderType
import com.dajaj.pos.domain.model.PaymentMethod

/**
 * Repository interface for order persistence operations.
 *
 * Handles writing orders to Firestore with offline fallback to Room Database.
 *
 * Two flavours of createOrder are provided:
 * - Typed [createOrder(NewOrder)] used by [ConfirmOrderUseCase]
 * - Raw-map [createOrder(Map)] used by legacy use cases (AcceptPendingOrderUseCase, CreateOrderUseCase)
 */
interface OrderRepository {

    /**
     * Creates an order in Firestore (or locally when offline).
     * Typed overload used by [ConfirmOrderUseCase].
     *
     * @param order Typed [NewOrder] input
     * @return [Result] containing a [CreatedOrder] with the generated ID and order number
     */
    suspend fun createOrder(order: NewOrder): Result<CreatedOrder>

    /**
     * Creates an order document using a raw field map.
     * Used by legacy use cases that build the order map themselves.
     *
     * @param orderData Map of order fields matching the Firestore orders schema
     * @return Result containing the created order ID on success
     */
    suspend fun createOrder(orderData: Map<String, Any?>): Result<String>

    /**
     * Creates a bill document using a raw field map.
     *
     * @param billData Map of bill fields matching the Firestore bills schema
     * @return Result containing the created bill ID on success
     */
    suspend fun createBill(billData: Map<String, Any?>): Result<String>

    /**
     * Creates a print job document using a raw field map.
     *
     * @param printJobData Map of print job fields matching the Firestore print_jobs schema
     * @return Result containing the created print job ID on success
     */
    suspend fun createPrintJob(printJobData: Map<String, Any?>): Result<String>

    /**
     * Saves an order locally to Room Database for offline processing.
     *
     * @param orderData Map of order fields
     * @param billData Map of bill fields
     * @param printJobData Map of print job fields
     * @return Result indicating success or failure of local save
     */
    suspend fun saveOrderLocally(
        orderData: Map<String, Any?>,
        billData: Map<String, Any?>,
        printJobData: Map<String, Any?>
    ): Result<Unit>
}

/**
 * Input data class for creating a new order (typed overload).
 */
data class NewOrder(
    val restaurantId: String,
    val channel: OrderChannel,
    val type: OrderType,
    val customerName: String,
    val customerPhone: String,
    val items: List<OrderItem>,
    val subtotal: Double,
    val discountAmount: Double,
    val serviceCharge: Double,
    val cgst: Double,
    val sgst: Double,
    val grandTotal: Double,
    val paymentMode: PaymentMethod,
    val cashierId: String
)

/**
 * Result of a successful order creation (typed overload).
 */
data class CreatedOrder(
    /** Firestore document ID of the created order. */
    val id: String,
    /** Human-readable order number (format: DDMMYY####). */
    val orderNumber: String
)
