package com.dajaj.pos.domain.usecase.cart

import com.dajaj.pos.domain.model.CartItem
import com.dajaj.pos.domain.model.CustomerInfo
import com.dajaj.pos.domain.model.DomainError
import com.dajaj.pos.domain.model.DomainException
import com.dajaj.pos.domain.model.MenuItem
import com.dajaj.pos.domain.model.OrderType
import javax.inject.Inject

/**
 * Domain-layer cart manager responsible for cart operations during POS order creation.
 *
 * Holds per-session state (items, order type, customer info) and enforces business rules:
 * - Quantity bounds: 1–99 per item
 * - Decrement below 1 removes item
 * - Order confirmation requires ≥1 item AND a selected order type
 *
 * This is NOT a singleton — each POS session creates a new instance.
 *
 * @see <a href="requirements.md">Requirements 5.5, 5.7, 5.9, 5.10</a>
 */
class CartManager @Inject constructor() {

    private val _items = mutableListOf<CartItem>()
    private var _orderType: OrderType? = null
    private var _customerInfo: CustomerInfo? = null

    /** Current list of items in the cart (defensive copy). */
    val items: List<CartItem> get() = _items.toList()

    /** Selected order type, or null if none selected yet. */
    val orderType: OrderType? get() = _orderType

    /** Optional customer info attached to this order. */
    val customerInfo: CustomerInfo? get() = _customerInfo

    /** Computed total: sum of all item line totals. */
    val total: Double get() = _items.sumOf { it.lineTotal }

    /** True when the cart has no items. */
    val isEmpty: Boolean get() = _items.isEmpty()

    companion object {
        /** Maximum allowed quantity per cart item. */
        const val MAX_QUANTITY = 99
    }

    /**
     * Adds an item to the cart with quantity 1.
     * If an item with the same [CartItem.id] already exists, increments its quantity instead.
     *
     * @return [Result.success] on success, [Result.failure] with [DomainError.InvalidInput]
     *         if incrementing would exceed [MAX_QUANTITY].
     */
    fun addItem(item: CartItem): Result<Unit> {
        val existingIndex = _items.indexOfFirst { it.id == item.id }

        if (existingIndex >= 0) {
            val existing = _items[existingIndex]
            if (existing.quantity >= MAX_QUANTITY) {
                return Result.failure(
                    DomainException(
                        DomainError.InvalidInput(
                            field = "quantity",
                            reason = "Maximum quantity of $MAX_QUANTITY reached for item '${existing.menuItem.name}'"
                        )
                    )
                )
            }
            val newQty = existing.quantity + 1
            _items[existingIndex] = existing.copy(
                quantity = newQty,
                lineTotal = calculateLineTotal(existing.menuItem, existing.variant, existing.modifiers, newQty)
            )
        } else {
            _items.add(item.copy(
                quantity = 1,
                lineTotal = calculateLineTotal(item.menuItem, item.variant, item.modifiers, 1)
            ))
        }
        return Result.success(Unit)
    }

    /**
     * Increments the quantity of the item identified by [itemId] by 1.
     * Maximum quantity is [MAX_QUANTITY].
     *
     * @return [Result.success] on success, [Result.failure] with [DomainError.InvalidInput]
     *         if item not found or quantity would exceed max.
     */
    fun incrementItem(itemId: String): Result<Unit> {
        val index = _items.indexOfFirst { it.id == itemId }
        if (index < 0) {
            return Result.failure(
                DomainException(
                    DomainError.InvalidInput(field = "itemId", reason = "Item not found in cart")
                )
            )
        }

        val item = _items[index]
        if (item.quantity >= MAX_QUANTITY) {
            return Result.failure(
                DomainException(
                    DomainError.InvalidInput(
                        field = "quantity",
                        reason = "Maximum quantity of $MAX_QUANTITY reached"
                    )
                )
            )
        }

        val newQty = item.quantity + 1
        _items[index] = item.copy(
            quantity = newQty,
            lineTotal = calculateLineTotal(item.menuItem, item.variant, item.modifiers, newQty)
        )
        return Result.success(Unit)
    }

    /**
     * Decrements the quantity of the item identified by [itemId] by 1.
     * If quantity goes below 1, the item is removed from the cart.
     *
     * @return [Result.success] on success, [Result.failure] with [DomainError.InvalidInput]
     *         if item not found.
     */
    fun decrementItem(itemId: String): Result<Unit> {
        val index = _items.indexOfFirst { it.id == itemId }
        if (index < 0) {
            return Result.failure(
                DomainException(
                    DomainError.InvalidInput(field = "itemId", reason = "Item not found in cart")
                )
            )
        }

        val item = _items[index]
        if (item.quantity <= 1) {
            _items.removeAt(index)
        } else {
            val newQty = item.quantity - 1
            _items[index] = item.copy(
                quantity = newQty,
                lineTotal = calculateLineTotal(item.menuItem, item.variant, item.modifiers, newQty)
            )
        }
        return Result.success(Unit)
    }

    /**
     * Removes the item identified by [itemId] entirely from the cart.
     *
     * @return [Result.success] on success, [Result.failure] with [DomainError.InvalidInput]
     *         if item not found.
     */
    fun removeItem(itemId: String): Result<Unit> {
        val removed = _items.removeAll { it.id == itemId }
        if (!removed) {
            return Result.failure(
                DomainException(
                    DomainError.InvalidInput(field = "itemId", reason = "Item not found in cart")
                )
            )
        }
        return Result.success(Unit)
    }

    /**
     * Sets the order type for this cart session.
     */
    fun setOrderType(type: OrderType) {
        _orderType = type
    }

    /**
     * Sets optional customer info for this order.
     */
    fun setCustomerInfo(info: CustomerInfo?) {
        _customerInfo = info
    }

    /**
     * Clears all items from the cart and resets order type and customer info.
     */
    fun clearCart() {
        _items.clear()
        _orderType = null
        _customerInfo = null
    }

    /**
     * Returns true if the cart can be confirmed for order creation:
     * - At least 1 item in the cart
     * - An order type has been selected
     */
    fun canConfirm(): Boolean {
        return _items.isNotEmpty() && _orderType != null
    }

    /**
     * Validates the cart state for order confirmation.
     *
     * @return [Result.success] if valid, [Result.failure] with [DomainError.InvalidInput]
     *         describing what's missing.
     */
    fun validateForConfirmation(): Result<Unit> {
        if (_items.isEmpty()) {
            return Result.failure(
                DomainException(
                    DomainError.InvalidInput(
                        field = "cart",
                        reason = "Cart must have at least 1 item"
                    )
                )
            )
        }
        if (_orderType == null) {
            return Result.failure(
                DomainException(
                    DomainError.InvalidInput(
                        field = "orderType",
                        reason = "Order type must be selected"
                    )
                )
            )
        }
        return Result.success(Unit)
    }

    /**
     * Computes the line total for an item:
     * (variant price or item price + sum of modifier prices) * quantity
     */
    private fun calculateLineTotal(
        menuItem: MenuItem,
        variant: MenuItem?,
        modifiers: List<MenuItem>,
        quantity: Int
    ): Double {
        val basePrice = variant?.price ?: menuItem.price
        val modifierTotal = modifiers.sumOf { it.price }
        return (basePrice + modifierTotal) * quantity
    }
}
