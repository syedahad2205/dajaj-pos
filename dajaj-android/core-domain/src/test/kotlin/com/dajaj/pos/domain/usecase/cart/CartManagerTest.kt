package com.dajaj.pos.domain.usecase.cart

import com.dajaj.pos.domain.model.CartItem
import com.dajaj.pos.domain.model.CustomerInfo
import com.dajaj.pos.domain.model.DomainError
import com.dajaj.pos.domain.model.DomainException
import com.dajaj.pos.domain.model.MenuItem
import com.dajaj.pos.domain.model.MenuItemType
import com.dajaj.pos.domain.model.OrderType
import com.dajaj.pos.domain.model.SelectionType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class CartManagerTest {

    private lateinit var cartManager: CartManager

    private val baseMenuItem = MenuItem(
        id = "menu_1",
        name = "Regular Alfaham",
        parentId = "cat_alfaham",
        type = MenuItemType.CATEGORY,
        price = 120.0,
        selectionType = SelectionType.NONE,
        minSelection = 0,
        maxSelection = 0,
        description = null,
        imageUrl = null,
        isAvailable = true,
        trackInventory = false,
        inventoryMultiplier = null,
        inventoryTrackingMode = null,
        order = 0,
        createdAt = System.currentTimeMillis(),
        updatedAt = System.currentTimeMillis()
    )

    private val variantItem = MenuItem(
        id = "var_quarter",
        name = "Quarter",
        parentId = "menu_1",
        type = MenuItemType.VARIANT,
        price = 90.0,
        selectionType = SelectionType.NONE,
        minSelection = 0,
        maxSelection = 0,
        description = null,
        imageUrl = null,
        isAvailable = true,
        trackInventory = false,
        inventoryMultiplier = null,
        inventoryTrackingMode = null,
        order = 0,
        createdAt = System.currentTimeMillis(),
        updatedAt = System.currentTimeMillis()
    )

    private val modifierItem = MenuItem(
        id = "mod_spicy",
        name = "Extra Spicy",
        parentId = "modgroup_1",
        type = MenuItemType.MODIFIER,
        price = 20.0,
        selectionType = SelectionType.NONE,
        minSelection = 0,
        maxSelection = 0,
        description = null,
        imageUrl = null,
        isAvailable = true,
        trackInventory = false,
        inventoryMultiplier = null,
        inventoryTrackingMode = null,
        order = 0,
        createdAt = System.currentTimeMillis(),
        updatedAt = System.currentTimeMillis()
    )

    private fun createCartItem(
        id: String = "cart_1",
        menuItem: MenuItem = baseMenuItem,
        variant: MenuItem? = null,
        modifiers: List<MenuItem> = emptyList(),
        quantity: Int = 1,
        notes: String? = null
    ): CartItem {
        val basePrice = variant?.price ?: menuItem.price
        val modTotal = modifiers.sumOf { it.price }
        return CartItem(
            id = id,
            menuItem = menuItem,
            variant = variant,
            modifiers = modifiers,
            quantity = quantity,
            notes = notes,
            lineTotal = (basePrice + modTotal) * quantity
        )
    }

    @Before
    fun setup() {
        cartManager = CartManager()
    }

    // --- addItem tests ---

    @Test
    fun `addItem adds item with quantity 1`() {
        val item = createCartItem(id = "cart_1")
        val result = cartManager.addItem(item)

        assertTrue(result.isSuccess)
        assertEquals(1, cartManager.items.size)
        assertEquals(1, cartManager.items[0].quantity)
        assertEquals("cart_1", cartManager.items[0].id)
    }

    @Test
    fun `addItem increments quantity if item already in cart`() {
        val item = createCartItem(id = "cart_1")
        cartManager.addItem(item)
        cartManager.addItem(item)

        assertEquals(1, cartManager.items.size)
        assertEquals(2, cartManager.items[0].quantity)
    }

    @Test
    fun `addItem recalculates lineTotal on increment`() {
        val item = createCartItem(id = "cart_1") // price 120
        cartManager.addItem(item)
        cartManager.addItem(item) // qty=2

        assertEquals(240.0, cartManager.items[0].lineTotal, 0.001)
    }

    @Test
    fun `addItem adds multiple different items`() {
        val item1 = createCartItem(id = "cart_1")
        val item2 = createCartItem(id = "cart_2", menuItem = baseMenuItem.copy(id = "menu_2", name = "Shawarma", price = 60.0))

        cartManager.addItem(item1)
        cartManager.addItem(item2)

        assertEquals(2, cartManager.items.size)
    }

    @Test
    fun `addItem fails when existing item at max quantity`() {
        val item = createCartItem(id = "cart_1", quantity = CartManager.MAX_QUANTITY)
        // Manually add at max qty
        cartManager.addItem(item)
        // The first addItem sets qty=1, so we need to increment to 99
        repeat(CartManager.MAX_QUANTITY - 1) {
            cartManager.incrementItem("cart_1")
        }

        val result = cartManager.addItem(item)

        assertTrue(result.isFailure)
        val error = (result.exceptionOrNull() as DomainException).domainError
        assertTrue(error is DomainError.InvalidInput)
        assertEquals("quantity", (error as DomainError.InvalidInput).field)
    }

    @Test
    fun `addItem with variant uses variant price`() {
        val item = createCartItem(id = "cart_1", variant = variantItem) // variant price 90
        cartManager.addItem(item)

        assertEquals(90.0, cartManager.items[0].lineTotal, 0.001)
    }

    @Test
    fun `addItem with modifiers includes modifier prices`() {
        val item = createCartItem(id = "cart_1", modifiers = listOf(modifierItem)) // 120 + 20 = 140
        cartManager.addItem(item)

        assertEquals(140.0, cartManager.items[0].lineTotal, 0.001)
    }

    @Test
    fun `addItem with variant and modifiers calculates correctly`() {
        val item = createCartItem(id = "cart_1", variant = variantItem, modifiers = listOf(modifierItem))
        // variant price 90 + modifier 20 = 110
        cartManager.addItem(item)

        assertEquals(110.0, cartManager.items[0].lineTotal, 0.001)
    }

    // --- incrementItem tests ---

    @Test
    fun `incrementItem increases quantity by 1`() {
        cartManager.addItem(createCartItem(id = "cart_1"))
        val result = cartManager.incrementItem("cart_1")

        assertTrue(result.isSuccess)
        assertEquals(2, cartManager.items[0].quantity)
    }

    @Test
    fun `incrementItem recalculates lineTotal`() {
        cartManager.addItem(createCartItem(id = "cart_1")) // price 120, qty 1
        cartManager.incrementItem("cart_1") // qty 2

        assertEquals(240.0, cartManager.items[0].lineTotal, 0.001)
    }

    @Test
    fun `incrementItem fails at max quantity 99`() {
        cartManager.addItem(createCartItem(id = "cart_1"))
        repeat(CartManager.MAX_QUANTITY - 1) {
            cartManager.incrementItem("cart_1")
        }
        // Now at 99
        val result = cartManager.incrementItem("cart_1")

        assertTrue(result.isFailure)
        val error = (result.exceptionOrNull() as DomainException).domainError
        assertTrue(error is DomainError.InvalidInput)
    }

    @Test
    fun `incrementItem fails for nonexistent item`() {
        val result = cartManager.incrementItem("nonexistent")

        assertTrue(result.isFailure)
        val error = (result.exceptionOrNull() as DomainException).domainError
        assertTrue(error is DomainError.InvalidInput)
        assertEquals("itemId", (error as DomainError.InvalidInput).field)
    }

    // --- decrementItem tests ---

    @Test
    fun `decrementItem decreases quantity by 1`() {
        cartManager.addItem(createCartItem(id = "cart_1"))
        cartManager.incrementItem("cart_1") // qty=2
        val result = cartManager.decrementItem("cart_1")

        assertTrue(result.isSuccess)
        assertEquals(1, cartManager.items[0].quantity)
    }

    @Test
    fun `decrementItem removes item when quantity goes below 1`() {
        cartManager.addItem(createCartItem(id = "cart_1")) // qty=1
        val result = cartManager.decrementItem("cart_1")

        assertTrue(result.isSuccess)
        assertTrue(cartManager.items.isEmpty())
    }

    @Test
    fun `decrementItem recalculates lineTotal`() {
        cartManager.addItem(createCartItem(id = "cart_1")) // price 120
        cartManager.incrementItem("cart_1") // qty=2, lineTotal=240
        cartManager.decrementItem("cart_1") // qty=1, lineTotal=120

        assertEquals(120.0, cartManager.items[0].lineTotal, 0.001)
    }

    @Test
    fun `decrementItem fails for nonexistent item`() {
        val result = cartManager.decrementItem("nonexistent")

        assertTrue(result.isFailure)
        val error = (result.exceptionOrNull() as DomainException).domainError
        assertTrue(error is DomainError.InvalidInput)
    }

    // --- removeItem tests ---

    @Test
    fun `removeItem removes item entirely`() {
        cartManager.addItem(createCartItem(id = "cart_1"))
        cartManager.addItem(createCartItem(id = "cart_2", menuItem = baseMenuItem.copy(id = "menu_2", price = 60.0)))
        val result = cartManager.removeItem("cart_1")

        assertTrue(result.isSuccess)
        assertEquals(1, cartManager.items.size)
        assertEquals("cart_2", cartManager.items[0].id)
    }

    @Test
    fun `removeItem fails for nonexistent item`() {
        val result = cartManager.removeItem("nonexistent")

        assertTrue(result.isFailure)
    }

    // --- clearCart tests ---

    @Test
    fun `clearCart removes all items`() {
        cartManager.addItem(createCartItem(id = "cart_1"))
        cartManager.addItem(createCartItem(id = "cart_2", menuItem = baseMenuItem.copy(id = "menu_2")))
        cartManager.setOrderType(OrderType.WALK_IN)
        cartManager.setCustomerInfo(CustomerInfo(name = "John", phone = "9876543210"))

        cartManager.clearCart()

        assertTrue(cartManager.items.isEmpty())
        assertNull(cartManager.orderType)
        assertNull(cartManager.customerInfo)
        assertEquals(0.0, cartManager.total, 0.001)
        assertTrue(cartManager.isEmpty)
    }

    // --- total tests ---

    @Test
    fun `total is sum of all item line totals`() {
        cartManager.addItem(createCartItem(id = "cart_1")) // 120
        cartManager.addItem(createCartItem(id = "cart_2", menuItem = baseMenuItem.copy(id = "menu_2", price = 60.0))) // 60

        assertEquals(180.0, cartManager.total, 0.001)
    }

    @Test
    fun `total is zero for empty cart`() {
        assertEquals(0.0, cartManager.total, 0.001)
    }

    @Test
    fun `total updates after quantity changes`() {
        cartManager.addItem(createCartItem(id = "cart_1")) // 120
        cartManager.incrementItem("cart_1") // 240

        assertEquals(240.0, cartManager.total, 0.001)
    }

    // --- isEmpty tests ---

    @Test
    fun `isEmpty is true for new cart`() {
        assertTrue(cartManager.isEmpty)
    }

    @Test
    fun `isEmpty is false after adding item`() {
        cartManager.addItem(createCartItem(id = "cart_1"))
        assertFalse(cartManager.isEmpty)
    }

    // --- setOrderType tests ---

    @Test
    fun `setOrderType updates order type`() {
        cartManager.setOrderType(OrderType.TAKEAWAY)
        assertEquals(OrderType.TAKEAWAY, cartManager.orderType)
    }

    @Test
    fun `setOrderType can be changed`() {
        cartManager.setOrderType(OrderType.WALK_IN)
        cartManager.setOrderType(OrderType.DINE_IN)
        assertEquals(OrderType.DINE_IN, cartManager.orderType)
    }

    // --- setCustomerInfo tests ---

    @Test
    fun `setCustomerInfo sets customer`() {
        val info = CustomerInfo(name = "Ali", phone = "9876543210")
        cartManager.setCustomerInfo(info)
        assertEquals(info, cartManager.customerInfo)
    }

    @Test
    fun `setCustomerInfo with null clears customer`() {
        cartManager.setCustomerInfo(CustomerInfo(name = "Ali", phone = "9876543210"))
        cartManager.setCustomerInfo(null)
        assertNull(cartManager.customerInfo)
    }

    // --- canConfirm tests ---

    @Test
    fun `canConfirm is false when cart is empty`() {
        cartManager.setOrderType(OrderType.WALK_IN)
        assertFalse(cartManager.canConfirm())
    }

    @Test
    fun `canConfirm is false when no order type selected`() {
        cartManager.addItem(createCartItem(id = "cart_1"))
        assertFalse(cartManager.canConfirm())
    }

    @Test
    fun `canConfirm is true when cart has items and order type selected`() {
        cartManager.addItem(createCartItem(id = "cart_1"))
        cartManager.setOrderType(OrderType.TAKEAWAY)
        assertTrue(cartManager.canConfirm())
    }

    @Test
    fun `canConfirm is false when cart empty and no order type`() {
        assertFalse(cartManager.canConfirm())
    }

    // --- validateForConfirmation tests ---

    @Test
    fun `validateForConfirmation fails with empty cart`() {
        cartManager.setOrderType(OrderType.WALK_IN)
        val result = cartManager.validateForConfirmation()

        assertTrue(result.isFailure)
        val error = (result.exceptionOrNull() as DomainException).domainError
        assertTrue(error is DomainError.InvalidInput)
        assertEquals("cart", (error as DomainError.InvalidInput).field)
    }

    @Test
    fun `validateForConfirmation fails with no order type`() {
        cartManager.addItem(createCartItem(id = "cart_1"))
        val result = cartManager.validateForConfirmation()

        assertTrue(result.isFailure)
        val error = (result.exceptionOrNull() as DomainException).domainError
        assertTrue(error is DomainError.InvalidInput)
        assertEquals("orderType", (error as DomainError.InvalidInput).field)
    }

    @Test
    fun `validateForConfirmation succeeds with items and order type`() {
        cartManager.addItem(createCartItem(id = "cart_1"))
        cartManager.setOrderType(OrderType.DINE_IN)
        val result = cartManager.validateForConfirmation()

        assertTrue(result.isSuccess)
    }

    @Test
    fun `validateForConfirmation fails with both missing`() {
        val result = cartManager.validateForConfirmation()

        assertTrue(result.isFailure)
        // Should fail on cart first (empty check is before order type check)
        val error = (result.exceptionOrNull() as DomainException).domainError
        assertEquals("cart", (error as DomainError.InvalidInput).field)
    }

    // --- items defensive copy ---

    @Test
    fun `items returns defensive copy`() {
        cartManager.addItem(createCartItem(id = "cart_1"))
        val itemsBefore = cartManager.items

        cartManager.addItem(createCartItem(id = "cart_2", menuItem = baseMenuItem.copy(id = "menu_2")))

        // Original reference should not have changed
        assertEquals(1, itemsBefore.size)
        assertEquals(2, cartManager.items.size)
    }
}
