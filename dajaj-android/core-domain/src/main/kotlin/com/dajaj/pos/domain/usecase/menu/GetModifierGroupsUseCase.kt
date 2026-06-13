package com.dajaj.pos.domain.usecase.menu

import com.dajaj.pos.common.Result
import com.dajaj.pos.domain.model.MenuItem
import com.dajaj.pos.domain.model.MenuItemType
import com.dajaj.pos.domain.repository.MenuRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import javax.inject.Inject

/**
 * Use case that loads modifier groups and their child modifiers for a given menu item.
 *
 * Used by the modifier selection dialog to display groups (e.g., "Spice Level")
 * and their modifiers (e.g., "Mild", "Medium", "Extra Spicy") with prices.
 *
 * The menu tree structure is: category → variant → modifierGroup → modifier
 * This use case fetches children of type MODIFIER_GROUP for a given item,
 * and for each group, fetches children of type MODIFIER.
 */
class GetModifierGroupsUseCase @Inject constructor(
    private val menuRepository: MenuRepository
) {

    /**
     * Loads modifier groups and their modifiers for the given [itemId].
     *
     * @param itemId The ID of the menu item (variant) whose modifier groups to load.
     * @return A list of pairs: (modifier group, list of modifiers in that group).
     */
    suspend operator fun invoke(itemId: String): Result<List<Pair<MenuItem, List<MenuItem>>>> {
        if (itemId.isBlank()) {
            return Result.Error("Item ID must not be blank")
        }

        return try {
            // Get modifier groups (children of the item that are modifierGroup type)
            val groups = menuRepository.getItemsByCategory(itemId)
                .first()
                .filter { it.type == MenuItemType.MODIFIER_GROUP }

            // For each group, get its modifier children
            val groupsWithModifiers = groups.map { group ->
                val modifiers = menuRepository.getItemsByCategory(group.id)
                    .first()
                    .filter { it.type == MenuItemType.MODIFIER }
                group to modifiers
            }

            Result.Success(groupsWithModifiers)
        } catch (e: Exception) {
            Result.Error("Failed to load modifier groups: ${e.message}", e)
        }
    }

    /**
     * Checks whether a given item has any modifier groups.
     * Used to determine whether to show the modifier dialog when an item is tapped.
     *
     * @param itemId The ID of the menu item to check.
     * @return true if the item has at least one modifier group child.
     */
    suspend fun hasModifiers(itemId: String): Boolean {
        if (itemId.isBlank()) return false
        return try {
            menuRepository.getItemsByCategory(itemId)
                .first()
                .any { it.type == MenuItemType.MODIFIER_GROUP }
        } catch (e: Exception) {
            false
        }
    }
}
