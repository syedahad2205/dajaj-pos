package com.dajaj.pos.feature.pos

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dajaj.pos.common.Result
import com.dajaj.pos.domain.model.MenuItemType
import com.dajaj.pos.domain.repository.MenuRepository
import com.dajaj.pos.domain.usecase.menu.GetCategoriesUseCase
import com.dajaj.pos.domain.usecase.menu.GetItemsByCategoryUseCase
import com.dajaj.pos.domain.usecase.menu.GetModifierGroupsUseCase
import com.dajaj.pos.domain.usecase.menu.SearchMenuUseCase
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * ViewModel for the POS screen managing category navigation, menu item display,
 * search filtering, and pull-to-refresh sync.
 *
 * Uses reactive flows from Room DB (via use cases) for fast category/item loading.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class PosViewModel @Inject constructor(
    private val getCategoriesUseCase: GetCategoriesUseCase,
    private val getItemsByCategoryUseCase: GetItemsByCategoryUseCase,
    private val searchMenuUseCase: SearchMenuUseCase,
    private val getModifierGroupsUseCase: GetModifierGroupsUseCase,
    private val menuRepository: MenuRepository
) : ViewModel() {

    // --- Categories ---

    /**
     * Observable list of categories for the left panel.
     * Prepends "★ Favorites" as the first item.
     */
    val categories: StateFlow<List<CategoryItem>> = getCategoriesUseCase()
        .map { result ->
            when (result) {
                is Result.Success -> {
                    val favorites = CategoryItem(
                        id = FAVORITES_CATEGORY_ID,
                        name = "★ Favorites",
                        isFavorites = true
                    )
                    val categoryItems = result.data.map { menuItem ->
                        CategoryItem(
                            id = menuItem.id,
                            name = menuItem.name,
                            isFavorites = false
                        )
                    }
                    listOf(favorites) + categoryItems
                }
                is Result.Error -> emptyList()
                is Result.Loading -> emptyList()
            }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    // --- Selected Category ---

    private val _selectedCategoryId = MutableStateFlow(FAVORITES_CATEGORY_ID)
    val selectedCategoryId: StateFlow<String> = _selectedCategoryId.asStateFlow()

    // --- Search Query ---

    private val _searchQuery = MutableStateFlow("")
    val searchQuery: StateFlow<String> = _searchQuery.asStateFlow()

    // --- Current Items ---

    /**
     * Observable list of menu items for the center panel.
     * When a search query is active, items are filtered by name across all categories.
     * When no search is active, items are loaded from the selected category.
     */
    val currentItems: StateFlow<List<MenuItem>> = _searchQuery
        .flatMapLatest { query ->
            if (query.isNotBlank()) {
                // Search mode: filter across all categories
                searchMenuUseCase(query).map { result ->
                    mapToMenuItems(result)
                }
            } else {
                // Category mode: load items for selected category
                _selectedCategoryId.flatMapLatest { categoryId ->
                    if (categoryId == FAVORITES_CATEGORY_ID) {
                        // Favorites will be loaded from a dedicated source in task 7.3
                        flowOf(emptyList())
                    } else {
                        getItemsByCategoryUseCase(categoryId).map { result ->
                            mapToMenuItems(result)
                        }
                    }
                }
            }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    // --- Refresh State ---

    private val _isRefreshing = MutableStateFlow(false)
    val isRefreshing: StateFlow<Boolean> = _isRefreshing.asStateFlow()

    // --- Actions ---

    /**
     * Selects a category, triggering item loading for that category.
     * Clears any active search query.
     */
    fun selectCategory(categoryId: String) {
        _searchQuery.value = ""
        _selectedCategoryId.value = categoryId
    }

    /**
     * Updates the search query. When non-blank, items are filtered by name
     * across all categories (case-insensitive).
     */
    fun search(query: String) {
        _searchQuery.value = query
    }

    /**
     * Triggers a pull-to-refresh sync from Firestore.
     * Forces the menu repository to re-sync its local cache with Firestore.
     */
    fun refresh() {
        viewModelScope.launch {
            _isRefreshing.value = true
            try {
                menuRepository.startSync()
            } finally {
                _isRefreshing.value = false
            }
        }
    }

    // --- Private Helpers ---

    private fun mapToMenuItems(result: Result<List<com.dajaj.pos.domain.model.MenuItem>>): List<MenuItem> {
        return when (result) {
            is Result.Success -> result.data.map { domainItem ->
                MenuItem(
                    id = domainItem.id,
                    name = domainItem.name,
                    variantLabel = domainItem.description,
                    price = domainItem.price.toInt(),
                    isAvailable = domainItem.isAvailable,
                    hasModifiers = domainItem.type == MenuItemType.VARIANT
                )
            }
            is Result.Error -> emptyList()
            is Result.Loading -> emptyList()
        }
    }

    /**
     * Loads modifier groups and their modifiers for the given item.
     * Returns the result via [onResult] callback for use by the fragment.
     */
    fun loadModifierGroups(
        itemId: String,
        onResult: (Result<List<Pair<com.dajaj.pos.domain.model.MenuItem, List<com.dajaj.pos.domain.model.MenuItem>>>>) -> Unit
    ) {
        viewModelScope.launch {
            val result = getModifierGroupsUseCase(itemId)
            onResult(result)
        }
    }

    companion object {
        const val FAVORITES_CATEGORY_ID = "__favorites__"
    }
}
