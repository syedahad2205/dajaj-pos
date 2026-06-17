package com.dajaj.pos.domain.repository

import com.dajaj.pos.common.Result
import kotlinx.coroutines.flow.Flow

/**
 * Repository interface for application settings and preferences.
 *
 * Provides access to configurable settings stored in Firestore,
 * such as tax rates, service charges, favorites, and app metadata.
 */
interface SettingsRepository {

    // ── Favorites ─────────────────────────────────────────────────────────────

    /**
     * Observes the list of favorite menu item IDs from the settings document.
     */
    fun getFavoriteItemIds(): Flow<List<String>>

    /**
     * Saves the given item IDs as favorites.
     */
    suspend fun updateFavoriteItemIds(itemIds: List<String>): Result<Unit>

    // ── Tax Rate ──────────────────────────────────────────────────────────────

    /**
     * Observes the configured tax rate (percent, e.g. 2.5 = 2.5%).
     * Defaults to 2.5 if not configured.
     */
    fun getTaxRate(): Flow<Double>

    /**
     * Persists a new tax rate value.
     */
    suspend fun updateTaxRate(rate: Double): Result<Unit>

    // ── Service Charge ────────────────────────────────────────────────────────

    /**
     * Observes the configured service charge percentage.
     * Defaults to 0.0 if not configured.
     */
    fun getServiceChargeRate(): Flow<Double>

    /**
     * Persists a new service charge percentage.
     */
    suspend fun updateServiceChargeRate(rate: Double): Result<Unit>

    // ── App Info ──────────────────────────────────────────────────────────────

    /**
     * Returns the current app version string (e.g. "1.0.0").
     */
    fun getAppVersion(): String
}
