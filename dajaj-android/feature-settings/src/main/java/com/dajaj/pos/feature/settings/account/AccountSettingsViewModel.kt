package com.dajaj.pos.feature.settings.account

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dajaj.pos.common.Result
import com.dajaj.pos.domain.model.MenuItem
import com.dajaj.pos.domain.repository.AuthRepository
import com.dajaj.pos.domain.repository.MenuRepository
import com.dajaj.pos.domain.repository.SettingsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * ViewModel for Account and General Settings screen.
 *
 * Implements Requirements 16.6, 16.8, 5.4:
 * - Tax rate configuration (0-28%, default 2.5%) with input validation
 * - Service charge configuration (0-25%, default 0%) with input validation
 * - Favorites management: select up to 20 menu items to mark as favorites
 * - App version info
 * - Logout button
 */
@HiltViewModel
class AccountSettingsViewModel @Inject constructor(
    private val settingsRepository: SettingsRepository,
    private val authRepository: AuthRepository,
    private val menuRepository: MenuRepository
) : ViewModel() {

    companion object {
        const val MIN_TAX_RATE = 0.0
        const val MAX_TAX_RATE = 28.0
        const val DEFAULT_TAX_RATE = 2.5

        const val MIN_SERVICE_CHARGE = 0.0
        const val MAX_SERVICE_CHARGE = 25.0
        const val DEFAULT_SERVICE_CHARGE = 0.0

        const val MAX_FAVORITES = 20
    }

    // ─── Tax Rate ───────────────────────────────────────────────────────────────

    val taxRate: StateFlow<Double> = settingsRepository.getTaxRate()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), DEFAULT_TAX_RATE)

    private val _taxRateError = MutableStateFlow<String?>(null)
    val taxRateError: StateFlow<String?> = _taxRateError.asStateFlow()

    // ─── Service Charge ─────────────────────────────────────────────────────────

    val serviceChargeRate: StateFlow<Double> = settingsRepository.getServiceChargeRate()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), DEFAULT_SERVICE_CHARGE)

    private val _serviceChargeError = MutableStateFlow<String?>(null)
    val serviceChargeError: StateFlow<String?> = _serviceChargeError.asStateFlow()

    // ─── Favorites ──────────────────────────────────────────────────────────────

    val favoriteItemIds: StateFlow<List<String>> = settingsRepository.getFavoriteItemIds()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    private val _availableItems = MutableStateFlow<List<MenuItem>>(emptyList())
    val availableItems: StateFlow<List<MenuItem>> = _availableItems.asStateFlow()

    private val _showFavoritesDialog = MutableStateFlow(false)
    val showFavoritesDialog: StateFlow<Boolean> = _showFavoritesDialog.asStateFlow()

    // ─── App Info ───────────────────────────────────────────────────────────────

    val appVersion: String = settingsRepository.getAppVersion()

    // ─── Events ─────────────────────────────────────────────────────────────────

    private val _error = MutableSharedFlow<String>()
    val error: SharedFlow<String> = _error.asSharedFlow()

    private val _message = MutableSharedFlow<String>()
    val message: SharedFlow<String> = _message.asSharedFlow()

    private val _logoutEvent = MutableSharedFlow<Unit>()
    val logoutEvent: SharedFlow<Unit> = _logoutEvent.asSharedFlow()

    // ─── Tax Rate Actions ───────────────────────────────────────────────────────

    /**
     * Updates the tax rate. Validates range [0, 28].
     */
    fun updateTaxRate(rateString: String) {
        val rate = rateString.toDoubleOrNull()

        if (rate == null) {
            _taxRateError.value = "Please enter a valid number"
            return
        }

        if (rate < MIN_TAX_RATE || rate > MAX_TAX_RATE) {
            _taxRateError.value = "Tax rate must be between ${MIN_TAX_RATE.toInt()}% and ${MAX_TAX_RATE.toInt()}%"
            return
        }

        _taxRateError.value = null

        viewModelScope.launch {
            when (val result = settingsRepository.updateTaxRate(rate)) {
                is Result.Success -> {
                    _message.emit("Tax rate updated to $rate%")
                }
                is Result.Error -> {
                    _error.emit(result.message)
                }
                is Result.Loading -> { /* no-op */ }
            }
        }
    }

    // ─── Service Charge Actions ─────────────────────────────────────────────────

    /**
     * Updates the service charge percentage. Validates range [0, 25].
     */
    fun updateServiceCharge(rateString: String) {
        val rate = rateString.toDoubleOrNull()

        if (rate == null) {
            _serviceChargeError.value = "Please enter a valid number"
            return
        }

        if (rate < MIN_SERVICE_CHARGE || rate > MAX_SERVICE_CHARGE) {
            _serviceChargeError.value = "Service charge must be between ${MIN_SERVICE_CHARGE.toInt()}% and ${MAX_SERVICE_CHARGE.toInt()}%"
            return
        }

        _serviceChargeError.value = null

        viewModelScope.launch {
            when (val result = settingsRepository.updateServiceChargeRate(rate)) {
                is Result.Success -> {
                    _message.emit("Service charge updated to $rate%")
                }
                is Result.Error -> {
                    _error.emit(result.message)
                }
                is Result.Loading -> { /* no-op */ }
            }
        }
    }

    // ─── Favorites Actions ──────────────────────────────────────────────────────

    /**
     * Opens the favorites selection dialog. Loads available menu items.
     */
    fun openFavoritesSelector() {
        viewModelScope.launch {
            val cachedMenu = menuRepository.getCachedMenu()
            // Filter to variant items only (items that can be ordered)
            _availableItems.value = cachedMenu.filter {
                it.type == com.dajaj.pos.domain.model.MenuItemType.VARIANT && it.isAvailable
            }
            _showFavoritesDialog.value = true
        }
    }

    /**
     * Closes the favorites selection dialog.
     */
    fun closeFavoritesSelector() {
        _showFavoritesDialog.value = false
    }

    /**
     * Saves the selected favorite item IDs. Maximum 20 items.
     */
    fun saveFavorites(selectedIds: List<String>) {
        if (selectedIds.size > MAX_FAVORITES) {
            viewModelScope.launch {
                _error.emit("Maximum $MAX_FAVORITES favorites allowed. Please deselect some items.")
            }
            return
        }

        viewModelScope.launch {
            when (val result = settingsRepository.updateFavoriteItemIds(selectedIds)) {
                is Result.Success -> {
                    _showFavoritesDialog.value = false
                    _message.emit("Favorites updated (${selectedIds.size}/$MAX_FAVORITES)")
                }
                is Result.Error -> {
                    _error.emit(result.message)
                }
                is Result.Loading -> { /* no-op */ }
            }
        }
    }

    // ─── Logout ─────────────────────────────────────────────────────────────────

    /**
     * Signs out the current user and emits a logout event for navigation.
     */
    fun logout() {
        viewModelScope.launch {
            authRepository.signOut()
            _logoutEvent.emit(Unit)
        }
    }
}
