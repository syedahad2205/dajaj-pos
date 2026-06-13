package com.dajaj.pos.domain.usecase.menu

import com.dajaj.pos.common.Result
import com.dajaj.pos.domain.model.MenuItem
import com.dajaj.pos.domain.repository.MenuRepository
import com.dajaj.pos.domain.repository.SettingsRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import javax.inject.Inject

/**
 * Use case that fetches favorite menu items configured by the manager.
 *
 * Reads favorite item IDs from the settings repository and resolves each ID
 * to a [MenuItem] from the menu repository. Returns at most [MAX_FAVORITES]
 * items, preserving the order defined in settings.
 *
 * Items that no longer exist in the menu or are unavailable are filtered out.
 */
class GetFavoritesUseCase @Inject constructor(
    private val settingsRepository: SettingsRepository,
    private val menuRepository: MenuRepository
) {

    companion object {
        /**
         * Maximum number of items in the Favorites section.
         * Mirrors [com.dajaj.pos.common.Constants.FAVORITES_MAX_ITEMS].
         */
        const val MAX_FAVORITES = 20
    }

    /**
     * Observes the resolved favorite menu items.
     *
     * Combines the favorite item IDs from settings with the full menu,
     * resolves IDs to [MenuItem] objects, filters out missing/unavailable items,
     * and limits the result to [MAX_FAVORITES].
     *
     * @return A [Flow] emitting [Result.Success] with resolved favorites,
     *         or [Result.Error] on failure.
     */
    operator fun invoke(): Flow<Result<List<MenuItem>>> {
        return combine(
            settingsRepository.getFavoriteItemIds(),
            menuRepository.observeMenu()
        ) { favoriteIds, allMenuItems ->
            val menuMap = allMenuItems.associateBy { it.id }
            val resolvedFavorites = favoriteIds
                .take(MAX_FAVORITES)
                .mapNotNull { id -> menuMap[id] }
                .filter { it.isAvailable }

            Result.Success(resolvedFavorites) as Result<List<MenuItem>>
        }.catch { e ->
            emit(Result.Error("Failed to load favorites: ${e.message}", e))
        }
    }
}
