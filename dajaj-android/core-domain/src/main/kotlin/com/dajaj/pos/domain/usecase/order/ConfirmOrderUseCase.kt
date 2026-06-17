package com.dajaj.pos.domain.usecase.order

import com.dajaj.pos.common.Result
import com.dajaj.pos.domain.model.BillCalculation
import com.dajaj.pos.domain.model.CartItem
import com.dajaj.pos.domain.model.CustomerInfo
import com.dajaj.pos.domain.model.OrderChannel
import com.dajaj.pos.domain.model.OrderType
import com.dajaj.pos.domain.model.PaymentInfo
import com.dajaj.pos.domain.model.PaymentMethod
import com.dajaj.pos.domain.model.PrintJobType
import com.dajaj.pos.domain.repository.BillingRepository
import com.dajaj.pos.domain.repository.CustomerRepository
import com.dajaj.pos.domain.repository.NewBill
import com.dajaj.pos.domain.repository.NewPrintJob
import com.dajaj.pos.domain.repository.OrderRepository
import com.dajaj.pos.domain.repository.NewOrder
import com.dajaj.pos.domain.repository.PrintQueueRepository
import com.dajaj.pos.domain.repository.PrintSource
import com.dajaj.pos.domain.usecase.billing.BillingCalculator
import com.dajaj.pos.domain.usecase.billing.Discount
import javax.inject.Inject

/**
 * Domain use case orchestrating the complete order confirmation and billing flow.
 *
 * This use case handles:
 * 1. Validation of prerequisites (cart ≥1 item, order type selected)
 * 2. Billing calculation via [BillingCalculator]
 * 3. Payment validation (cash change, mixed split sums)
 * 4. Order creation via [OrderRepository]
 * 5. Bill creation via [BillingRepository]
 * 6. KOT print job creation via [PrintQueueRepository]
 * 7. Customer record creation/update via [CustomerRepository]
 *
 * On KOT print failure: the order remains confirmed, print job is queued for retry.
 * Customer defaults to "Walk-in Customer" if no customer details are provided.
 *
 * @see <a href="requirements.md">Requirements 5.7, 5.8, 5.9, 16.1-16.4, 19.3, 19.6</a>
 */
class ConfirmOrderUseCase @Inject constructor(
    private val orderRepository: OrderRepository,
    private val billingRepository: BillingRepository,
    private val printQueueRepository: PrintQueueRepository,
    private val customerRepository: CustomerRepository
) {

    /**
     * Input data for order confirmation.
     */
    data class ConfirmOrderInput(
        val items: List<CartItem>,
        val orderType: OrderType,
        val paymentInfo: PaymentInfo,
        val discount: Discount?,
        val serviceChargePercent: Double,
        val taxRatePercent: Double,
        val customer: CustomerInfo?,
        val restaurantId: String,
        val cashierId: String,
        val channel: OrderChannel = OrderChannel.WALK_IN
    )

    /**
     * Result of a successful order confirmation.
     */
    data class ConfirmOrderResult(
        val orderId: String,
        val orderNumber: String,
        val billId: String,
        val billCalculation: BillCalculation,
        val changeAmount: Double?,
        val printJobFailed: Boolean
    )

    /**
     * Executes the full order confirmation flow.
     *
     * @param input All data needed to confirm the order
     * @return [Result] containing [ConfirmOrderResult] on success
     */
    suspend operator fun invoke(input: ConfirmOrderInput): Result<ConfirmOrderResult> {
        // 1. Validate cart has items
        if (input.items.isEmpty()) {
            return Result.Error("Cart must contain at least one item")
        }

        // 2. Calculate billing
        val billResult = BillingCalculator.calculateBill(
            subtotal = input.items.sumOf { it.lineTotal },
            discount = input.discount,
            serviceChargePercent = input.serviceChargePercent,
            taxRatePercent = input.taxRatePercent
        )

        if (billResult.isFailure) {
            return Result.Error(
                billResult.exceptionOrNull()?.message ?: "Billing calculation failed"
            )
        }

        val billCalculation = billResult.getOrThrow()

        // 3. Validate payment
        var changeAmount: Double? = null
        when (input.paymentInfo.method) {
            PaymentMethod.CASH -> {
                val cashCollected = input.paymentInfo.cashCollected
                    ?: return Result.Error("Cash collected amount is required for cash payment")
                val cashValidation = BillingCalculator.validateCashPayment(
                    cashCollected = cashCollected,
                    grandTotal = billCalculation.grandTotal
                )
                if (cashValidation.isFailure) {
                    return Result.Error(
                        cashValidation.exceptionOrNull()?.message ?: "Cash payment validation failed"
                    )
                }
                changeAmount = cashValidation.getOrThrow()
            }
            PaymentMethod.MIXED -> {
                val splits = input.paymentInfo.splits
                    ?: return Result.Error("Payment splits are required for mixed payment")
                val domainSplits = splits.map { split ->
                    com.dajaj.pos.domain.model.PaymentSplit(
                        method = split.method,
                        amount = split.amount
                    )
                }
                val mixedValidation = BillingCalculator.validateMixedPayment(
                    splits = domainSplits,
                    grandTotal = billCalculation.grandTotal
                )
                if (mixedValidation.isFailure) {
                    return Result.Error(
                        mixedValidation.exceptionOrNull()?.message ?: "Mixed payment validation failed"
                    )
                }
            }
            PaymentMethod.CARD, PaymentMethod.UPI -> {
                // No additional validation needed for card/UPI
            }
        }

        // 4. Resolve customer info
        val customerName = input.customer?.name?.takeIf { it.isNotBlank() } ?: "Walk-in Customer"
        val customerPhone = input.customer?.phone ?: ""

        // 5. Create order
        val orderItems = input.items.map { cartItem ->
            com.dajaj.pos.domain.model.OrderItem(
                id = cartItem.id,
                name = cartItem.menuItem.name,
                variantLabel = cartItem.variant?.name,
                variantId = cartItem.variant?.id,
                qty = cartItem.quantity,
                basePrice = cartItem.variant?.price ?: cartItem.menuItem.price,
                modifiers = cartItem.modifiers.map { mod ->
                    com.dajaj.pos.domain.model.OrderItemModifier(
                        id = mod.id,
                        name = mod.name,
                        price = mod.price,
                        groupName = ""
                    )
                },
                itemTotal = cartItem.lineTotal
            )
        }

        val newOrder = NewOrder(
            restaurantId = input.restaurantId,
            channel = input.channel,
            type = input.orderType,
            customerName = customerName,
            customerPhone = customerPhone,
            items = orderItems,
            subtotal = billCalculation.subtotal,
            discountAmount = billCalculation.discountAmount,
            serviceCharge = billCalculation.serviceChargeAmount,
            cgst = billCalculation.cgst,
            sgst = billCalculation.sgst,
            grandTotal = billCalculation.grandTotal,
            paymentMode = input.paymentInfo.method,
            cashierId = input.cashierId
        )

        val orderResult = orderRepository.createOrder(newOrder)
        if (orderResult is Result.Error) {
            return Result.Error("Order creation failed: ${orderResult.message}", orderResult.throwable)
        }

        val createdOrder = (orderResult as Result.Success).data

        // 6. Create bill
        val billItems = input.items.map { cartItem ->
            com.dajaj.pos.domain.repository.BillItem(
                id = cartItem.id,
                name = cartItem.menuItem.name,
                variantLabel = cartItem.variant?.name,
                qty = cartItem.quantity,
                basePrice = cartItem.variant?.price ?: cartItem.menuItem.price,
                modifiers = cartItem.modifiers.map { mod ->
                    com.dajaj.pos.domain.repository.BillModifier(
                        id = mod.id,
                        name = mod.name,
                        price = mod.price,
                        groupName = ""
                    )
                },
                itemTotal = cartItem.lineTotal
            )
        }

        val paymentSplits = input.paymentInfo.splits?.map { split ->
            com.dajaj.pos.domain.repository.PaymentSplit(
                method = split.method.toFirestoreValue(),
                amount = split.amount
            )
        }

        val newBill = NewBill(
            orderNumber = createdOrder.orderNumber,
            restaurantId = input.restaurantId,
            orderType = input.orderType.toFirestoreValue(),
            channel = input.channel.toFirestoreValue(),  // uses OrderChannel.toFirestoreValue()
            items = billItems,
            subtotal = billCalculation.subtotal,
            discountAmount = billCalculation.discountAmount,
            discountType = input.discount?.type?.name?.lowercase(),
            discountValue = input.discount?.value,
            discountReason = input.discount?.reason,
            serviceChargePercent = input.serviceChargePercent,
            serviceChargeAmount = billCalculation.serviceChargeAmount,
            cgst = billCalculation.cgst,
            sgst = billCalculation.sgst,
            grandTotal = billCalculation.grandTotal,
            paymentMode = input.paymentInfo.method.toFirestoreValue(),
            cashCollected = input.paymentInfo.cashCollected,
            paymentSplits = paymentSplits,
            punchedBy = input.cashierId,
            customerName = customerName,
            customerPhone = customerPhone
        )

        val billCreateResult = billingRepository.createBill(newBill)
        val billId = when (billCreateResult) {
            is Result.Success -> billCreateResult.data
            is Result.Error -> "" // Bill creation failed but order is confirmed
            is Result.Loading -> ""
        }

        // 7. Create KOT print job
        var printJobFailed = false
        val kotPayload = buildKotPayload(
            orderNumber = createdOrder.orderNumber,
            orderType = input.orderType,
            items = input.items,
            timestamp = System.currentTimeMillis()
        )

        val printJob = NewPrintJob(
            jobType = PrintJobType.KOT,
            printerType = "kot",
            orderId = createdOrder.id,
            orderNumber = createdOrder.orderNumber,
            payload = kotPayload,
            source = PrintSource.ANDROID_POS
        )

        val printResult = printQueueRepository.createPrintJob(printJob)
        if (printResult is Result.Error) {
            // Per requirement 5.7: on KOT print failure, retain order, queue for retry
            printJobFailed = true
        }

        // 8. Create or update customer record if provided
        if (input.customer != null && input.customer.phone.isNotBlank()) {
            val customerRepoInfo = com.dajaj.pos.domain.repository.CustomerInfo(
                name = input.customer.name,
                phone = input.customer.phone
            )
            // Fire-and-forget — don't fail order if customer update fails
            try {
                customerRepository.createOrUpdate(customerRepoInfo)
            } catch (_: Exception) {
                // Customer record update is non-critical
            }
        }

        return Result.Success(
            ConfirmOrderResult(
                orderId = createdOrder.id,
                orderNumber = createdOrder.orderNumber,
                billId = billId,
                billCalculation = billCalculation,
                changeAmount = changeAmount,
                printJobFailed = printJobFailed
            )
        )
    }

    /**
     * Builds the KOT print payload map for the print queue.
     */
    private fun buildKotPayload(
        orderNumber: String,
        orderType: OrderType,
        items: List<CartItem>,
        timestamp: Long
    ): Map<String, Any> {
        return mapOf(
            "header" to "KITCHEN ORDER",
            "orderNumber" to orderNumber,
            "orderType" to orderType.toDisplayName(),
            "timestamp" to timestamp.toString(),
            "items" to items.map { item ->
                mapOf(
                    "qty" to item.quantity,
                    "name" to item.menuItem.name,
                    "modifiers" to item.modifiers.map { mod -> mod.name },
                    "notes" to (item.notes ?: "")
                )
            },
            "specialNotes" to ""
        )
    }

    private fun OrderType.toDisplayName(): String = when (this) {
        OrderType.WALK_IN -> "Walk-in"
        OrderType.TAKEAWAY -> "Takeaway"
        OrderType.DINE_IN -> "Dine-in"
        OrderType.DELIVERY -> "Delivery"
    }

}
