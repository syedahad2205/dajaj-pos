package com.dajaj.pos.feature.pos

import com.dajaj.pos.feature.pos.model.CartItem
import com.dajaj.pos.feature.pos.model.ModifierSelection
import com.dajaj.pos.feature.pos.model.OrderType
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class CartManagerTest {

    private lateinit var cartManager: CartManager

    private val menuItem1 = MenuItem(
        id = "item_1",
        name = "Regular Alfaham",
        variantLabel = "Quarter",
        price = 120,
        isAvailable = true,
        hasModifiers = false
    )

    private val menuItem2 = MenuItem(
        id = "item_2",
        name = "Peri Peri Shawarma",
        variantLabel = "Roll",
        price = 60,
        isAvailable = true,
        hasModifiers = false
    )

    private val menuItem3 = MenuItem(
        id = "item_3",
        name = "Tandoori Chicken",
        variantLabel = "Full",
        price = 300,
        isAvailable = true,
        hasModifiers = true
    )

    @Before
    fun setup() {
        cartManager = CartManager()
    }

    @Test
    fun `addItem adds item with quantity 1`() = runTest {
        cartManager.addItem(menuItem1)

        val state = cartManager.cartState.first()
        assertEquals(1, state.items.size)
        assertEquals(1, state.items[0].quantity)
        assertEquals("item_1", state.items[0].menuItem.id)
    }

    @Test
    fun `addItem increments quantity if item already in cart`() = runTest {
        cartManager.addItem(menuItem1)
        cartManager.addItem(menuItem1)

        val state = cartManager.cartState.first()
        assertEquals(1, state.items.size)
        assertEquals(2, state.items[0].quantity)
    }

    @Test
    fun `addItem adds multiple different items`() = runTest {
        cartManager.addItem(menuItem1)
        cartManager.addItem(menuItem2)

        val state = cartManager.cartState.first()
        assertEquals(2, state.items.size)
    }

    @Test
    fun `incrementQuantity increases item quantity by 1`() = runTest {
        cartManager.addItem(menuItem1)
        cartManager.incrementQuantity("item_1")

        val state = cartManager.cartState.first()
        assertEquals(2, state.items[0].quantity)
    }

    @Test
    fun `decrementQuantity decreases item quantity by 1`() = runTest {
        cartManager.addItem(menuItem1)
        cartManager.incrementQuantity("item_1") // qty = 2
        cartManager.decrementQuantity("item_1") // qty = 1

        val state = cartManager.cartState.first()
        assertEquals(1, state.items[0].quantity)
    }

    @Test
    fun `decrementQuantity removes item at quantity 0`() = runTest {
        cartManager.addItem(menuItem1) // qty = 1
        cartManager.decrementQuantity("item_1") // removes

        val state = cartManager.cartState.first()
        assertTrue(state.items.isEmpty())
    }

    @Test
    fun `removeItem removes item entirely`() = runTest {
        cartManager.addItem(menuItem1)
        cartManager.addItem(menuItem2)
        cartManager.removeItem("item_1")

        val state = cartManager.cartState.first()
        assertEquals(1, state.items.size)
        assertEquals("item_2", state.items[0].menuItem.id)
    }

    @Test
    fun `clearCart removes all items and resets order type`() = runTest {
        cartManager.addItem(menuItem1)
        cartManager.addItem(menuItem2)
        cartManager.setOrderType(OrderType.WALK_IN)
        cartManager.clearCart()

        val state = cartManager.cartState.first()
        assertTrue(state.items.isEmpty())
        assertEquals(0.0, state.subtotal, 0.001)
        assertEquals(0.0, state.grandTotal, 0.001)
    }

    @Test
    fun `subtotal equals sum of all item line totals`() = runTest {
        cartManager.addItem(menuItem1) // 120 * 1 = 120
        cartManager.addItem(menuItem2) // 60 * 1 = 60

        val state = cartManager.cartState.first()
        assertEquals(180.0, state.subtotal, 0.001)
    }

    @Test
    fun `subtotal calculates correctly with multiple quantities`() = runTest {
        cartManager.addItem(menuItem1) // 120 * 1
        cartManager.incrementQuantity("item_1") // 120 * 2 = 240
        cartManager.addItem(menuItem2) // 60 * 1

        val state = cartManager.cartState.first()
        assertEquals(300.0, state.subtotal, 0.001)
    }

    @Test
    fun `CGST is 2_5 percent of subtotal`() = runTest {
        cartManager.addItem(menuItem1) // subtotal = 120

        val state = cartManager.cartState.first()
        assertEquals(120.0 * 0.025, state.cgst, 0.001)
    }

    @Test
    fun `SGST is 2_5 percent of subtotal`() = runTest {
        cartManager.addItem(menuItem1) // subtotal = 120

        val state = cartManager.cartState.first()
        assertEquals(120.0 * 0.025, state.sgst, 0.001)
    }

    @Test
    fun `grandTotal equals subtotal plus CGST plus SGST`() = runTest {
        cartManager.addItem(menuItem1) // subtotal = 120
        // cgst = 3.0, sgst = 3.0, grand = 126.0

        val state = cartManager.cartState.first()
        val expectedGrand = 120.0 + 120.0 * 0.025 + 120.0 * 0.025
        assertEquals(expectedGrand, state.grandTotal, 0.001)
    }

    @Test
    fun `canConfirm is false when cart is empty`() = runTest {
        cartManager.setOrderType(OrderType.WALK_IN)

        val state = cartManager.cartState.first()
        assertFalse(state.canConfirm)
    }

    @Test
    fun `canConfirm is false when no order type selected`() = runTest {
        cartManager.addItem(menuItem1)

        val state = cartManager.cartState.first()
        assertFalse(state.canConfirm)
    }

    @Test
    fun `canConfirm is true when cart has items and order type is selected`() = runTest {
        cartManager.addItem(menuItem1)
        cartManager.setOrderType(OrderType.TAKEAWAY)

        val state = cartManager.cartState.first()
        assertTrue(state.canConfirm)
    }

    @Test
    fun `setOrderType updates state`() = runTest {
        cartManager.setOrderType(OrderType.DINE_IN)

        val state = cartManager.cartState.first()
        assertEquals(OrderType.DINE_IN, state.orderType)
    }

    @Test
    fun `initializeOrderLabel generates DDMMYY format label`() = runTest {
        cartManager.initializeOrderLabel()

        val state = cartManager.cartState.first()
        assertTrue(state.orderLabel.isNotEmpty())
        // Format: DDMMYY#### (10 chars)
        assertEquals(10, state.orderLabel.length)
    }

    @Test
    fun `orderLabel has 4 digit sequential counter`() = runTest {
        cartManager.initializeOrderLabel()

        val state = cartManager.cartState.first()
        val sequencePart = state.orderLabel.substring(6)
        assertEquals("0001", sequencePart)
    }

    @Test
    fun `clearCart generates new order label`() = runTest {
        cartManager.initializeOrderLabel()
        cartManager.addItem(menuItem1)
        cartManager.clearCart()

        val state = cartManager.cartState.first()
        assertTrue(state.orderLabel.isNotEmpty())
        // Should be 0002 since it's the next sequential number
        val sequencePart = state.orderLabel.substring(6)
        assertEquals("0002", sequencePart)
    }

    @Test
    fun `addItem with modifiers calculates line total correctly`() = runTest {
        val modifiers = listOf(
            ModifierSelection(id = "mod_1", name = "Extra Spicy", price = 20.0, groupName = "Spice Level")
        )
        cartManager.addItem(menuItem1, modifiers) // (120 + 20) * 1 = 140

        val state = cartManager.cartState.first()
        assertEquals(140.0, state.items[0].lineTotal, 0.001)
        assertEquals(140.0, state.subtotal, 0.001)
    }

    @Test
    fun `incrementQuantity on nonexistent item does nothing`() = runTest {
        cartManager.addItem(menuItem1)
        cartManager.incrementQuantity("nonexistent")

        val state = cartManager.cartState.first()
        assertEquals(1, state.items.size)
        assertEquals(1, state.items[0].quantity)
    }

    @Test
    fun `decrementQuantity on nonexistent item does nothing`() = runTest {
        cartManager.addItem(menuItem1)
        cartManager.decrementQuantity("nonexistent")

        val state = cartManager.cartState.first()
        assertEquals(1, state.items.size)
    }

    @Test
    fun `removeItem on nonexistent item does nothing`() = runTest {
        cartManager.addItem(menuItem1)
        cartManager.removeItem("nonexistent")

        val state = cartManager.cartState.first()
        assertEquals(1, state.items.size)
    }
}
