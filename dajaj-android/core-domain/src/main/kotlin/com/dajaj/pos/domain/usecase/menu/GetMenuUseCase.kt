package com.dajaj.pos.domain.usecase.menu

import com.dajaj.pos.common.Result
import com.dajaj.pos.domain.model.MenuItem
import com.dajaj.pos.domain.repository.MenuRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import javax.inject.Inject

/**
 * Use case that observes the full menu from the local cache.
 *
 * The menu is always served from Room (offline-first). The Firestore → Room
 * sync is handled separately by the repository's [startSync] mechanism.
 * This use case simply exposes the cached data as a [Result] flow, mapping
 * empty states to an appropriate message.
 */
class GetMenuUseCase @Inject constructor(
    private val menuRepository: MenuRepository
) {

    /**
     * Observes all menu items from the local cache.
     *
     * @return A [Flow] emitting [Result.Success] with menu items, or [Result.Error]
     *         if an unexpected read error occurs.
     */
    operator fun invoke(): Flow<Result<List<MenuItem>>> {
        return menuRepository.observeMenu()
            .map<List<MenuItem>, Result<List<MenuItem>>> { items ->
                if (items.isEmpty()) {
                    Result.Success(emptyList())
                } else {
                    Result.Success(items)
                }
            }
            .catch { e ->
                emit(Result.Error("Failed to load menu: ${e.message}", e))
            }
    }
}
