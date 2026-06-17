package com.dajaj.pos.domain.model

/**
 * Domain model representing a confirmed order from any channel.
 *
 * Maps to the Firestore `orders` collection. Contains full lifecycle timestamps,
 * financial breakdown, and payment information.
 */
data class Order(
    /** Unique order identifier (Firestore document ID). */
    val id: String,

    /** Human-readable order number (format: DDMMYY####). */
    val orderNumber: String,

    /** Restaurant this order belongs to. */
    val restaurantId: String,

    /** Source channel from which this order originated. */
    val channel: OrderChannel,

    /** Fulfillment type (walk-in, takeaway, dine-in, delivery). */
    val type: OrderType,

    /** Current lifecycle status of the order. */
    val status: OrderStatus,

    /** Customer name (default: "Walk-in Customer"). */
    val customerName: String,

    /** Customer phone (10-digit Indian mobile or empty). */
    val customerPhone: String,

    /** Line items in this order (max 50 items). */
    val items: List<OrderItem>,

    /** Sum of all item totals before discounts and charges. */
    val subtotal: Double,

    /** Discount amount applied to this order. */
    val discountAmount: Double,

    /** Service charge amount. */
    val serviceCharge: Double,

    /** Central GST amount. */
    val cgst: Double,

    /** State GST amount. */
    val sgst: Double,

    /** Final total after all calculations (subtotal - discount + service + taxes). */
    val grandTotal: Double,

    /** Payment method used. */
    val paymentMode: PaymentMethod,

    /** ID of the cashier who processed this order. */
    val cashierId: String,

    /** Reason for rejection (1-200 chars), null if not rejected. */
    val rejectionReason: String?,

    /** Timestamp when the order was created (epoch millis). */
    val createdAt: Long,

    /** Timestamp when the order was accepted (epoch millis), null if not yet accepted. */
    val acceptedAt: Long?,

    /** Timestamp when preparation started (epoch millis), null if not yet preparing. */
    val preparingAt: Long?,

    /** Timestamp when the order was marked ready (epoch millis), null if not yet ready. */
    val readyAt: Long?,

    /** Timestamp when the order was completed (epoch millis), null if not yet completed. */
    val completedAt: Long?
)

/**
 * Represents a single line item within an order.
 *
 * Contains variant info, modifiers, quantity, and computed line total.
 */
data class OrderItem(
    /** Unique item ID within the order. */
    val id: String,

    /** Display name of the menu item. */
    val name: String,

    /** Variant label (e.g., "Quarter", "Half", "Full"). */
    val variantLabel: String?,

    /** Variant menu item ID. */
    val variantId: String?,

    /** Quantity ordered (1-99). */
    val qty: Int,

    /** Base price of the item (before modifiers). */
    val basePrice: Double,

    /** Applied modifiers with their prices. */
    val modifiers: List<OrderItemModifier>,

    /** Total for this line item (basePrice + modifiers) * qty. */
    val itemTotal: Double
)

/**
 * Represents a modifier applied to an order item.
 */
data class OrderItemModifier(
    /** Modifier menu item ID. */
    val id: String,

    /** Display name of the modifier. */
    val name: String,

    /** Additional price for this modifier. */
    val price: Double,

    /** Name of the modifier group this belongs to. */
    val groupName: String
)
