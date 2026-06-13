package com.dajaj.pos.domain.usecase.menu

import com.dajaj.pos.common.Result
import com.dajaj.pos.domain.model.MenuItem
import com.dajaj.pos.domain.repository.MenuRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import javax.inject.Inject

/**
 * Use case that searches menu items by name from the local cache.
 *
 * Performs case-insensitive substring matching against item names.
 * Used by the POS search bar to filter items across all categories.
 */
class SearchMenuUseCase @Inject constructor(
    private val menuRepository: MenuRepository
) {

    /**
     * Searches menu items whose names contain the given [query].
     *
     * @param query The search term. If blank, returns an empty list.
     * @return A [Flow] emitting [Result.Success] with matching items, or [Result.Error]
     *         on failure.
     */
    operator fun invoke(query: String): Flow<Result<List<MenuItem>>> {
        if (query.isBlank()) {
            return flowOf(Result.Success(emptyList()))
        }

        return menuRepository.searchItems(query)
            .map { items ->
                Result.Success(items) as Result<List<MenuItem>>
            }
            .catch { e ->
                emit(Result.Error("Failed to search menu: ${e.message}", e))
            }
    }
}
