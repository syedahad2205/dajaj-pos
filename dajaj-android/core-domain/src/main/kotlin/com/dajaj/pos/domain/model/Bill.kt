package com.dajaj.pos.domain.model

/**
 * Domain model representing a persisted bill record.
 *
 * Bills are generated after an order is completed and payment is received.
 * Each bill has a public token (UUID) enabling customer access via shared link.
 */
data class Bill(
    /** Unique bill identifier (Firestore document ID). */
    val id: String,

    /** Sequential bill number (>1000). */
    val billNo: String,

    /** UUID for customer access without authentication. */
    val publicToken: String,

    /** Restaurant this bill belongs to. */
    val restaurantId: String,

    /** Associated order number. */
    val orderNumber: String,

    /** Order fulfillment type. */
    val orderType: OrderType,

    /** Source channel of the order. */
    val channel: OrderChannel,

    /** Itemized list of billed items. */
    val items: List<OrderItem>,

    /** Sum of all item totals. */
    val subtotal: Double,

    /** Applied discount amount. */
    val discountAmount: Double,

    /** Discount type: "percentage" or "fixed". */
    val discountType: String?,

    /** Discount value (percentage value or fixed amount). */
    val discountValue: Double?,

    /** Reason for applying discount (1-100 chars), null if no discount. */
    val discountReason: String?,

    /** Service charge percentage applied. */
    val serviceChargePercent: Double,

    /** Calculated service charge amount. */
    val serviceChargeAmount: Double,

    /** Central GST amount. */
    val cgst: Double,

    /** State GST amount. */
    val sgst: Double,

    /** Final bill total. */
    val grandTotal: Double,

    /** Primary payment method. */
    val paymentMode: PaymentMethod,

    /** Cash amount collected (for change calculation), null if not cash. */
    val cashCollected: Double?,

    /** Payment splits for MIXED payments (max 4), null if not mixed. */
    val paymentSplits: List<PaymentSplit>?,

    /** Name/ID of the cashier who punched this bill. */
    val punchedBy: String,

    /** Customer information attached to this bill. */
    val customer: CustomerInfo?,

    /** Timestamp when the bill was created (epoch millis). */
    val createdAt: Long
)
