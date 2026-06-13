package com.dajaj.pos.feature.pos

import android.content.pm.ActivityInfo
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.widget.doAfterTextChanged
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.ItemTouchHelper
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.dajaj.pos.common.Result
import com.dajaj.pos.common.extensions.toRupees
import com.dajaj.pos.feature.pos.databinding.FragmentPosBinding
import com.dajaj.pos.feature.pos.model.CartState
import com.dajaj.pos.feature.pos.model.OrderType
import com.dajaj.pos.feature.pos.modifier.ModifierBottomSheetFragment
import com.dajaj.pos.feature.pos.model.ModifierSelection
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.snackbar.Snackbar
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * POS (Point of Sale) screen fragment.
 *
 * Displays a three-panel landscape layout:
 * - Left (200dp): Category navigation with "★ Favorites" as the first item
 * - Center (flex): Menu items grid with search bar and pull-to-refresh
 * - Right (320dp): Cart with order summary, type selection, and confirmation
 *
 * This fragment enforces landscape-only orientation for the POS workflow.
 */
@AndroidEntryPoint
class PosFragment : Fragment() {

    private var _binding: FragmentPosBinding? = null
    private val binding get() = _binding!!

    private val viewModel: PosViewModel by viewModels()

    @Inject
    lateinit var cartManager: CartManager

    @Inject
    lateinit var orderConfirmationUseCase: OrderConfirmationUseCase

    // Adapters
    private var categoryAdapter: CategoryAdapter? = null
    private var menuItemAdapter: MenuItemAdapter? = null
    private var cartAdapter: CartAdapter? = null

    /** Flag to prevent double-tap on confirm button. */
    private var isConfirming = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Enforce landscape orientation for POS screen
        requireActivity().requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentPosBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        setupCategoryRecyclerView()
        setupMenuItemsRecyclerView()
        setupCartRecyclerView()
        setupSearchBar()
        setupOrderTypeSelector()
        setupActionButtons()
        observeViewModel()
        observeCartState()
        cartManager.initializeOrderLabel()
    }

    /**
     * Sets up the left panel RecyclerView for categories.
     * Uses a vertical LinearLayoutManager. The first item is always "★ Favorites".
     */
    private fun setupCategoryRecyclerView() {
        categoryAdapter = CategoryAdapter { categoryItem ->
            viewModel.selectCategory(categoryItem.id)
        }
        binding.rvCategories.apply {
            layoutManager = LinearLayoutManager(requireContext())
            adapter = categoryAdapter
        }
    }

    /**
     * Sets up the center panel RecyclerView for menu items.
     * Uses a GridLayoutManager with 3-4 columns depending on available width.
     * Configures SwipeRefreshLayout for pull-to-refresh sync from Firestore.
     */
    private fun setupMenuItemsRecyclerView() {
        menuItemAdapter = MenuItemAdapter { menuItem ->
            onMenuItemTapped(menuItem)
        }
        val spanCount = calculateGridSpanCount()
        binding.rvMenuItems.apply {
            layoutManager = GridLayoutManager(requireContext(), spanCount)
            adapter = menuItemAdapter
        }
        // Pull-to-refresh syncs from Firestore
        binding.swipeRefreshMenu.setOnRefreshListener {
            viewModel.refresh()
        }
    }

    /**
     * Handles a menu item tap. If the item has modifiers (hasModifiers = true),
     * shows the modifier selection bottom sheet. Otherwise, adds directly to cart.
     */
    private fun onMenuItemTapped(menuItem: MenuItem) {
        if (menuItem.hasModifiers) {
            showModifierDialog(menuItem)
        } else {
            cartManager.addItem(menuItem)
        }
    }

    /**
     * Shows the modifier bottom sheet dialog for an item with modifier groups.
     * Loads modifier groups from the menu tree and displays the selection UI.
     */
    private fun showModifierDialog(menuItem: MenuItem) {
        viewModel.loadModifierGroups(menuItem.id) { result ->
            when (result) {
                is Result.Success -> {
                    val groups = result.data
                    if (groups.isEmpty()) {
                        // No modifier groups found, add directly to cart
                        cartManager.addItem(menuItem)
                        return@loadModifierGroups
                    }

                    // Find the domain MenuItem for the sheet title
                    val domainItem = com.dajaj.pos.domain.model.MenuItem(
                        id = menuItem.id,
                        name = menuItem.name,
                        parentId = null,
                        type = com.dajaj.pos.domain.model.MenuItemType.VARIANT,
                        price = menuItem.price.toDouble(),
                        selectionType = com.dajaj.pos.domain.model.SelectionType.NONE,
                        minSelection = 0,
                        maxSelection = 0,
                        description = menuItem.variantLabel,
                        imageUrl = null,
                        isAvailable = menuItem.isAvailable,
                        trackInventory = false,
                        inventoryMultiplier = null,
                        inventoryTrackingMode = null,
                        order = 0,
                        createdAt = 0L,
                        updatedAt = 0L
                    )

                    ModifierBottomSheetFragment.show(
                        fragmentManager = childFragmentManager,
                        menuItem = domainItem,
                        modifierGroups = groups,
                        listener = object : ModifierBottomSheetFragment.ModifierSelectionListener {
                            override fun onModifiersSelected(
                                menuItemId: String,
                                modifiers: List<ModifierSelection>
                            ) {
                                cartManager.addItem(menuItem, modifiers)
                            }
                        }
                    )
                }
                is Result.Error -> {
                    // Fallback: add without modifiers if loading fails
                    cartManager.addItem(menuItem)
                }
                is Result.Loading -> { /* No-op */ }
            }
        }
    }

    /**
     * Sets up the right panel RecyclerView for cart items.
     * Uses a vertical LinearLayoutManager with nested scrolling disabled
     * (wrapped inside a ScrollView).
     * Configures swipe-to-delete via ItemTouchHelper.
     */
    private fun setupCartRecyclerView() {
        cartAdapter = CartAdapter(
            onIncrement = { item -> cartManager.incrementQuantity(item.menuItem.id) },
            onDecrement = { item -> cartManager.decrementQuantity(item.menuItem.id) }
        )

        binding.rvCartItems.apply {
            layoutManager = LinearLayoutManager(requireContext())
            isNestedScrollingEnabled = false
            adapter = cartAdapter
        }

        // Swipe-to-delete support
        val swipeHandler = object : ItemTouchHelper.SimpleCallback(0, ItemTouchHelper.LEFT or ItemTouchHelper.RIGHT) {
            override fun onMove(
                recyclerView: RecyclerView,
                viewHolder: RecyclerView.ViewHolder,
                target: RecyclerView.ViewHolder
            ): Boolean = false

            override fun onSwiped(viewHolder: RecyclerView.ViewHolder, direction: Int) {
                val position = viewHolder.adapterPosition
                val item = cartAdapter?.currentList?.getOrNull(position) ?: return
                cartManager.removeItem(item.menuItem.id)
            }
        }
        ItemTouchHelper(swipeHandler).attachToRecyclerView(binding.rvCartItems)
    }

    /**
     * Sets up the search bar to filter menu items by name.
     * Case-insensitive filtering across all categories.
     */
    private fun setupSearchBar() {
        binding.etSearch.doAfterTextChanged { text ->
            viewModel.search(text?.toString() ?: "")
        }
    }

    /**
     * Sets up order type RadioGroup change listener.
     * Order types: Walk-in, Takeaway, Dine-in.
     */
    private fun setupOrderTypeSelector() {
        binding.rgOrderType.setOnCheckedChangeListener { _, checkedId ->
            val orderType = when (checkedId) {
                binding.rbWalkIn.id -> OrderType.WALK_IN
                binding.rbTakeaway.id -> OrderType.TAKEAWAY
                binding.rbDineIn.id -> OrderType.DINE_IN
                else -> return@setOnCheckedChangeListener
            }
            cartManager.setOrderType(orderType)
        }
    }

    /**
     * Sets up Confirm Order and Clear Cart button click listeners.
     */
    private fun setupActionButtons() {
        binding.btnConfirmOrder.setOnClickListener {
            confirmOrder()
        }

        binding.btnClearCart.setOnClickListener {
            showClearCartConfirmation()
        }
    }

    /**
     * Initiates order confirmation.
     * Shows a loading overlay, disables the button, and calls the use case.
     * On success: clears cart, shows snackbar, generates new order label.
     * On error: shows error snackbar with retry option.
     */
    private fun confirmOrder() {
        if (isConfirming) return
        val currentState = cartManager.cartState.value
        if (!currentState.canConfirm) return

        isConfirming = true
        showLoadingOverlay(true)
        binding.btnConfirmOrder.isEnabled = false

        viewLifecycleOwner.lifecycleScope.launch {
            val result = orderConfirmationUseCase(
                cartState = currentState,
                restaurantId = "dajaj_main",
                cashierId = "" // Will be populated from auth session
            )

            showLoadingOverlay(false)
            isConfirming = false

            when (result) {
                is Result.Success -> {
                    val confirmation = result.data
                    // Clear cart and generate new order label
                    cartManager.clearCart()
                    binding.rgOrderType.clearCheck()

                    // Show success snackbar
                    Snackbar.make(
                        binding.root,
                        "Order #${confirmation.orderNumber} confirmed • Bill: ${confirmation.billNumber}",
                        Snackbar.LENGTH_LONG
                    ).show()
                }
                is Result.Error -> {
                    binding.btnConfirmOrder.isEnabled = currentState.canConfirm
                    Snackbar.make(
                        binding.root,
                        "Order failed: ${result.message}",
                        Snackbar.LENGTH_LONG
                    ).setAction("Retry") {
                        confirmOrder()
                    }.show()
                }
                is Result.Loading -> {
                    // Should not happen
                    binding.btnConfirmOrder.isEnabled = currentState.canConfirm
                }
            }
        }
    }

    /**
     * Shows or hides the full-screen loading overlay during order confirmation.
     */
    private fun showLoadingOverlay(show: Boolean) {
        if (_binding == null) return
        binding.layoutLoadingOverlay.visibility = if (show) View.VISIBLE else View.GONE
    }

    /**
     * Observes PosViewModel state flows for categories, menu items, and refresh state.
     * Uses repeatOnLifecycle to safely collect flows tied to the fragment's lifecycle.
     */
    private fun observeViewModel() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                // Observe categories for left panel
                launch {
                    viewModel.categories.collect { categories ->
                        categoryAdapter?.submitList(categories)
                    }
                }

                // Observe current items for center panel (category items or search results)
                launch {
                    viewModel.currentItems.collect { items ->
                        menuItemAdapter?.submitList(items)
                    }
                }

                // Observe refresh state for SwipeRefreshLayout
                launch {
                    viewModel.isRefreshing.collect { refreshing ->
                        binding.swipeRefreshMenu.isRefreshing = refreshing
                    }
                }
            }
        }
    }

    /**
     * Observes the CartManager's cartState flow and updates the UI reactively.
     */
    private fun observeCartState() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                cartManager.cartState.collect { state ->
                    updateCartUI(state)
                }
            }
        }
    }

    /**
     * Updates all cart-related UI elements from the given [CartState].
     */
    private fun updateCartUI(state: CartState) {
        // Update cart items list
        cartAdapter?.submitList(state.items)

        // Toggle empty state visibility
        binding.tvEmptyCart.visibility = if (state.items.isEmpty()) View.VISIBLE else View.GONE

        // Update totals
        binding.tvSubtotal.text = state.subtotal.toRupees()
        binding.tvTax.text = (state.cgst + state.sgst).toRupees()
        binding.tvTotal.text = state.grandTotal.toRupees()

        // Update order label
        if (state.orderLabel.isNotEmpty()) {
            binding.tvOrderLabel.text = "Order #${state.orderLabel}"
        }

        // Update confirm button state
        binding.btnConfirmOrder.isEnabled = state.canConfirm
    }

    /**
     * Shows a confirmation dialog before clearing the cart.
     */
    private fun showClearCartConfirmation() {
        if (_binding == null) return
        if (cartManager.cartState.value.items.isEmpty()) return

        MaterialAlertDialogBuilder(requireContext())
            .setTitle("Clear Cart")
            .setMessage("Are you sure you want to clear all items from the cart?")
            .setPositiveButton("Clear") { _, _ ->
                cartManager.clearCart()
                binding.rgOrderType.clearCheck()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    /**
     * Calculates the optimal grid span count for the menu items panel.
     * Returns 3 for narrower displays, 4 for wider ones.
     */
    private fun calculateGridSpanCount(): Int {
        val displayMetrics = resources.displayMetrics
        val screenWidthDp = displayMetrics.widthPixels / displayMetrics.density
        // Approximate center panel width: total - 200dp (left) - 320dp (right) - padding
        val centerPanelWidthDp = screenWidthDp - 200f - 320f - 32f
        // Target card width ~140dp minimum
        val columns = (centerPanelWidthDp / 140f).toInt()
        return columns.coerceIn(3, 4)
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
        categoryAdapter = null
        menuItemAdapter = null
        cartAdapter = null
    }

    override fun onDestroy() {
        super.onDestroy()
        // Reset orientation when leaving POS screen
        requireActivity().requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    }
}
