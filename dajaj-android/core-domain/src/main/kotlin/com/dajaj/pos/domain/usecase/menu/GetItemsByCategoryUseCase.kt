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
 * Use case that observes menu items belonging to a specific category.
 *
 * Used by the POS center panel to display items when a category is selected.
 * Data is always served from the local Room cache for offline-first access.
 */
class GetItemsByCategoryUseCase @Inject constructor(
    private val menuRepository: MenuRepository
) {

    /**
     * Observes items for the given [categoryId], sorted by display order.
     *
     * @param categoryId The ID of the parent category whose children to fetch.
     * @return A [Flow] emitting [Result.Success] with items, or [Result.Error] on failure.
     */
    operator fun invoke(categoryId: String): Flow<Result<List<MenuItem>>> {
        if (categoryId.isBlank()) {
            return flowOf(
                Result.Error("Category ID must not be blank")
            )
        }

        return menuRepository.getItemsByCategory(categoryId)
            .map { items ->
                Result.Success(items) as Result<List<MenuItem>>
            }
            .catch { e ->
                emit(Result.Error("Failed to load items for category: ${e.message}", e))
            }
    }
}
