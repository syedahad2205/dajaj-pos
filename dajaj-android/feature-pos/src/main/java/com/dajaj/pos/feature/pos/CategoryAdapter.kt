package com.dajaj.pos.feature.pos

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.dajaj.pos.feature.pos.databinding.ItemCategoryBinding

/**
 * Adapter for the left panel category list.
 * Displays menu categories with "★ Favorites" as the first item.
 * Highlights the currently selected category.
 *
 * Stub — full implementation in task 7.2.
 */
class CategoryAdapter(
    private val onCategorySelected: (CategoryItem) -> Unit
) : ListAdapter<CategoryItem, CategoryAdapter.CategoryViewHolder>(CategoryDiffCallback()) {

    private var selectedPosition: Int = 0

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): CategoryViewHolder {
        val binding = ItemCategoryBinding.inflate(
            LayoutInflater.from(parent.context), parent, false
        )
        return CategoryViewHolder(binding)
    }

    override fun onBindViewHolder(holder: CategoryViewHolder, position: Int) {
        val item = getItem(position)
        val isSelected = position == selectedPosition
        holder.bind(item, isSelected)
        holder.itemView.setOnClickListener {
            val previousPosition = selectedPosition
            selectedPosition = holder.adapterPosition
            notifyItemChanged(previousPosition)
            notifyItemChanged(selectedPosition)
            onCategorySelected(item)
        }
    }

    class CategoryViewHolder(
        private val binding: ItemCategoryBinding
    ) : RecyclerView.ViewHolder(binding.root) {

        fun bind(item: CategoryItem, isSelected: Boolean) {
            binding.tvCategoryName.text = item.name
            binding.viewSelectedIndicator.visibility = if (isSelected) {
                android.view.View.VISIBLE
            } else {
                android.view.View.GONE
            }
            binding.root.isActivated = isSelected
            binding.root.contentDescription = if (isSelected) {
                "${item.name}, selected"
            } else {
                item.name
            }
        }
    }

    private class CategoryDiffCallback : DiffUtil.ItemCallback<CategoryItem>() {
        override fun areItemsTheSame(oldItem: CategoryItem, newItem: CategoryItem): Boolean =
            oldItem.id == newItem.id

        override fun areContentsTheSame(oldItem: CategoryItem, newItem: CategoryItem): Boolean =
            oldItem == newItem
    }
}

/**
 * Data class representing a category list item.
 */
data class CategoryItem(
    val id: String,
    val name: String,
    val isFavorites: Boolean = false
)
