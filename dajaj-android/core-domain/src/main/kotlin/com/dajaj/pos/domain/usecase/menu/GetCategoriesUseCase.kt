package com.dajaj.pos.domain.usecase.menu

import com.dajaj.pos.common.Result
import com.dajaj.pos.domain.model.MenuItem
import com.dajaj.pos.domain.repository.MenuRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import javax.inject.Inject

/**
 * Use case that observes root-level menu categories from the local cache.
 *
 * Categories are the top-level nodes in the menu tree (items with null parentId).
 * They are displayed in the POS left panel for category-based navigation.
 */
class GetCategoriesUseCase @Inject constructor(
    private val menuRepository: MenuRepository
) {

    /**
     * Observes root-level categories sorted by display order.
     *
     * @return A [Flow] emitting [Result.Success] with categories, or [Result.Error]
     *         on failure.
     */
    operator fun invoke(): Flow<Result<List<MenuItem>>> {
        return menuRepository.getCategories()
            .map { categories ->
                Result.Success(categories) as Result<List<MenuItem>>
            }
            .catch { e ->
                emit(Result.Error("Failed to load categories: ${e.message}", e))
            }
    }
}
