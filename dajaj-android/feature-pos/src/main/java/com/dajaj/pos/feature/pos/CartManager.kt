package com.dajaj.pos.feature.pos

import com.dajaj.pos.common.extensions.calculateCGST
import com.dajaj.pos.common.extensions.calculateSGST
import com.dajaj.pos.feature.pos.model.CartItem
import com.dajaj.pos.feature.pos.model.CartState
import com.dajaj.pos.feature.pos.model.ModifierSelection
import com.dajaj.pos.feature.pos.model.OrderType
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.atomic.AtomicInteger
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Manages the POS cart state including items, quantities, order type,
 * and reactive calculation of totals (subtotal, CGST, SGST, grand total).
 *
 * Exposes [cartState] as a [StateFlow] for reactive UI observation.
 * Every mutation recalculates totals using CurrencyExtensions (CGST 2.5%, SGST 2.5%).
 */
@Singleton
class CartManager @Inject constructor() {

    private val _cartState = MutableStateFlow(CartState.EMPTY)
    val cartState: StateFlow<CartState> = _cartState.asStateFlow()

    /** Daily sequential counter for order labels within a session. */
    private val dailyCounter = AtomicInteger(1)
    private var lastDateString: String = getCurrentDateString()

    /**
     * Adds a menu item to the cart with quantity 1.
     * If the item already exists (by id), increments its quantity instead.
     */
    fun addItem(menuItem: MenuItem, modifiers: List<ModifierSelection> = emptyList()) {
        val currentItems = _cartState.value.items.toMutableList()
        val existingIndex = currentItems.indexOfFirst { it.menuItem.id == menuItem.id }

        if (existingIndex >= 0) {
            val existing = currentItems[existingIndex]
            currentItems[existingIndex] = existing.copy(quantity = existing.quantity + 1)
        } else {
            currentItems.add(CartItem(menuItem = menuItem, quantity = 1, modifiers = modifiers))
        }

        updateState(currentItems)
    }

    /**
     * Increments the quantity of a cart item by 1.
     */
    fun incrementQuantity(itemId: String) {
        val currentItems = _cartState.value.items.toMutableList()
        val index = currentItems.indexOfFirst { it.menuItem.id == itemId }

        if (index >= 0) {
            val item = currentItems[index]
            currentItems[index] = item.copy(quantity = item.quantity + 1)
            updateState(currentItems)
        }
    }

    /**
     * Decrements the quantity of a cart item by 1.
     * Removes the item from the cart if quantity reaches 0.
     */
    fun decrementQuantity(itemId: String) {
        val currentItems = _cartState.value.items.toMutableList()
        val index = currentItems.indexOfFirst { it.menuItem.id == itemId }

        if (index >= 0) {
            val item = currentItems[index]
            if (item.quantity <= 1) {
                currentItems.removeAt(index)
            } else {
                currentItems[index] = item.copy(quantity = item.quantity - 1)
            }
            updateState(currentItems)
        }
    }

    /**
     * Removes an item from the cart entirely (e.g., swipe-to-delete).
     */
    fun removeItem(itemId: String) {
        val currentItems = _cartState.value.items.toMutableList()
        currentItems.removeAll { it.menuItem.id == itemId }
        updateState(currentItems)
    }

    /**
     * Clears all items from the cart and resets the order type.
     * Generates a new order label for the next order.
     */
    fun clearCart() {
        _cartState.value = CartState.EMPTY.copy(orderLabel = generateOrderLabel())
    }

    /**
     * Sets the order type (WALK_IN, TAKEAWAY, DINE_IN).
     */
    fun setOrderType(type: OrderType) {
        val current = _cartState.value
        _cartState.value = current.copy(
            orderType = type,
            canConfirm = current.items.isNotEmpty()
        )
    }

    /**
     * Generates an initial order label when the cart is first used.
     * Should be called when the POS screen is opened.
     */
    fun initializeOrderLabel() {
        if (_cartState.value.orderLabel.isEmpty()) {
            _cartState.value = _cartState.value.copy(orderLabel = generateOrderLabel())
        }
    }

    /**
     * Updates the cart state with new items and recalculates all totals.
     */
    private fun updateState(items: List<CartItem>) {
        val subtotal = items.sumOf { it.lineTotal }
        val cgst = subtotal.calculateCGST()
        val sgst = subtotal.calculateSGST()
        val grandTotal = subtotal + cgst + sgst

        val currentState = _cartState.value
        _cartState.value = currentState.copy(
            items = items,
            subtotal = subtotal,
            cgst = cgst,
            sgst = sgst,
            grandTotal = grandTotal,
            canConfirm = items.isNotEmpty() && currentState.orderType != null,
            orderLabel = currentState.orderLabel.ifEmpty { generateOrderLabel() }
        )
    }

    /**
     * Generates an auto order label in format DDMMYY####.
     * The #### is a zero-padded sequential counter that resets daily.
     */
    private fun generateOrderLabel(): String {
        val currentDate = getCurrentDateString()
        if (currentDate != lastDateString) {
            dailyCounter.set(1)
            lastDateString = currentDate
        }
        val sequence = dailyCounter.getAndIncrement()
        return "$currentDate${sequence.toString().padStart(4, '0')}"
    }

    /**
     * Returns the current date as DDMMYY string.
     */
    private fun getCurrentDateString(): String {
        val dateFormat = SimpleDateFormat("ddMMyy", Locale.getDefault())
        return dateFormat.format(Date())
    }
}
