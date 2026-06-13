package com.dajaj.pos.feature.pos

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.dajaj.pos.common.extensions.toRupees
import com.dajaj.pos.feature.pos.databinding.ItemCartEntryBinding
import com.dajaj.pos.feature.pos.model.CartItem

/**
 * Adapter for the right panel cart items list.
 * Displays cart entries with quantity controls (+/-), item name, modifiers, and line total.
 * Supports swipe-to-delete via ItemTouchHelper (configured externally).
 */
class CartAdapter(
    private val onIncrement: (CartItem) -> Unit,
    private val onDecrement: (CartItem) -> Unit
) : ListAdapter<CartItem, CartAdapter.CartViewHolder>(CartDiffCallback()) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): CartViewHolder {
        val binding = ItemCartEntryBinding.inflate(
            LayoutInflater.from(parent.context), parent, false
        )
        return CartViewHolder(binding)
    }

    override fun onBindViewHolder(holder: CartViewHolder, position: Int) {
        val item = getItem(position)
        holder.bind(item)
        holder.binding.btnIncrease.setOnClickListener { onIncrement(item) }
        holder.binding.btnDecrease.setOnClickListener { onDecrement(item) }
    }

    class CartViewHolder(
        val binding: ItemCartEntryBinding
    ) : RecyclerView.ViewHolder(binding.root) {

        fun bind(item: CartItem) {
            binding.tvQuantity.text = item.quantity.toString()
            binding.tvCartItemName.text = item.menuItem.name
            binding.tvCartItemTotal.text = item.lineTotal.toRupees()

            val modifierText = item.modifierDisplay
            if (modifierText.isNullOrEmpty()) {
                binding.tvCartItemModifiers.visibility = View.GONE
            } else {
                binding.tvCartItemModifiers.visibility = View.VISIBLE
                binding.tvCartItemModifiers.text = modifierText
            }

            binding.root.contentDescription = buildString {
                append("${item.quantity} ${item.menuItem.name}")
                if (!modifierText.isNullOrEmpty()) {
                    append(", $modifierText")
                }
                append(", ${item.lineTotal.toRupees()}")
            }
        }
    }

    private class CartDiffCallback : DiffUtil.ItemCallback<CartItem>() {
        override fun areItemsTheSame(oldItem: CartItem, newItem: CartItem): Boolean =
            oldItem.menuItem.id == newItem.menuItem.id

        override fun areContentsTheSame(oldItem: CartItem, newItem: CartItem): Boolean =
            oldItem == newItem
    }
}
