package com.dajaj.pos.feature.pos

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.dajaj.pos.feature.pos.databinding.ItemMenuCardBinding

/**
 * Adapter for the center panel menu items grid.
 * Displays menu item cards with name, variant label, price, and availability badge.
 * Unavailable items are shown grayed out and are non-tappable.
 *
 * Stub — full implementation in task 7.2.
 */
class MenuItemAdapter(
    private val onItemTapped: (MenuItem) -> Unit
) : ListAdapter<MenuItem, MenuItemAdapter.MenuItemViewHolder>(MenuItemDiffCallback()) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): MenuItemViewHolder {
        val binding = ItemMenuCardBinding.inflate(
            LayoutInflater.from(parent.context), parent, false
        )
        return MenuItemViewHolder(binding)
    }

    override fun onBindViewHolder(holder: MenuItemViewHolder, position: Int) {
        val item = getItem(position)
        holder.bind(item)
        if (item.isAvailable) {
            holder.itemView.setOnClickListener { onItemTapped(item) }
            holder.itemView.alpha = 1.0f
        } else {
            holder.itemView.setOnClickListener(null)
            holder.itemView.isClickable = false
            holder.itemView.alpha = 0.5f
        }
    }

    class MenuItemViewHolder(
        private val binding: ItemMenuCardBinding
    ) : RecyclerView.ViewHolder(binding.root) {

        fun bind(item: MenuItem) {
            binding.tvItemName.text = item.name
            binding.tvVariantLabel.text = item.variantLabel
            binding.tvVariantLabel.visibility = if (item.variantLabel.isNullOrEmpty()) {
                View.GONE
            } else {
                View.VISIBLE
            }
            binding.tvPrice.text = "₹${item.price}"

            if (!item.isAvailable) {
                binding.tvAvailability.visibility = View.VISIBLE
                binding.tvAvailability.text = "Sold Out"
            } else {
                binding.tvAvailability.visibility = View.GONE
            }

            binding.root.contentDescription = buildString {
                append(item.name)
                if (!item.variantLabel.isNullOrEmpty()) {
                    append(", ${item.variantLabel}")
                }
                append(", ₹${item.price}")
                if (!item.isAvailable) {
                    append(", sold out")
                }
            }
        }
    }

    private class MenuItemDiffCallback : DiffUtil.ItemCallback<MenuItem>() {
        override fun areItemsTheSame(oldItem: MenuItem, newItem: MenuItem): Boolean =
            oldItem.id == newItem.id

        override fun areContentsTheSame(oldItem: MenuItem, newItem: MenuItem): Boolean =
            oldItem == newItem
    }
}

/**
 * Data class representing a menu item in the grid.
 */
data class MenuItem(
    val id: String,
    val name: String,
    val variantLabel: String? = null,
    val price: Int,
    val isAvailable: Boolean = true,
    val hasModifiers: Boolean = false
)

/**
 * Wraps a [MenuItem] with its current cart quantity for the row adapter.
 * qty == 0 means the item is not yet in the cart.
 */
data class MenuItemWithQty(
    val item: MenuItem,
    val qty: Int = 0
)
