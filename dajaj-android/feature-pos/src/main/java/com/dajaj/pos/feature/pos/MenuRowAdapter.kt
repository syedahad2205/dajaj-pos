package com.dajaj.pos.feature.pos

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.dajaj.pos.feature.pos.databinding.ItemMenuRowBinding
import com.google.android.material.button.MaterialButton

/**
 * Adapter for the menu item list — horizontal rows.
 *
 * Each row: [Name (+ Customisable hint)] | [Price] | [ADD / stepper / OOS]
 *
 * No description, no image. Clean POS scan pattern.
 *
 * hasModifiers drives whether a bottom-sheet appears or the item is added directly.
 * Inline stepper is only shown when qty > 0 AND item has NO modifiers
 * (items with modifiers always go through the sheet so each add is a fresh selection).
 */
class MenuRowAdapter(
    private val onAddItem: (MenuItemWithQty) -> Unit,
    private val onIncrementItem: (MenuItemWithQty) -> Unit,
    private val onDecrementItem: (MenuItemWithQty) -> Unit
) : ListAdapter<MenuItemWithQty, MenuRowAdapter.RowViewHolder>(DiffCallback()) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RowViewHolder {
        val binding = ItemMenuRowBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return RowViewHolder(binding)
    }

    override fun onBindViewHolder(holder: RowViewHolder, position: Int) {
        val entry = getItem(position)
        holder.bind(entry)
        holder.binding.btnAdd.setOnClickListener { onAddItem(entry) }
        holder.binding.btnStepperDecrease.setOnClickListener { onDecrementItem(entry) }
        holder.binding.btnStepperIncrease.setOnClickListener { onIncrementItem(entry) }
    }

    inner class RowViewHolder(val binding: ItemMenuRowBinding) :
        RecyclerView.ViewHolder(binding.root) {

        fun bind(entry: MenuItemWithQty) {
            val item = entry.item
            val qty = entry.qty

            binding.tvItemName.text = item.name
            binding.tvPrice.text = "₹${item.price}"

            // Show "Customisable ›" only for items that have modifier groups
            binding.tvCustomisable.visibility =
                if (item.hasModifiers) View.VISIBLE else View.GONE

            if (!item.isAvailable) {
                binding.root.alpha = 0.5f
                binding.btnAdd.visibility = View.GONE
                binding.layoutStepper.visibility = View.GONE
                binding.tvUnavailable.visibility = View.VISIBLE
            } else {
                binding.root.alpha = 1f
                binding.tvUnavailable.visibility = View.GONE

                // Items with modifiers: always show ADD (each add opens the sheet)
                // Items without modifiers: show stepper when qty > 0
                if (qty > 0 && !item.hasModifiers) {
                    binding.btnAdd.visibility = View.GONE
                    binding.layoutStepper.visibility = View.VISIBLE
                    binding.tvStepperQty.text = qty.toString()
                } else {
                    binding.btnAdd.visibility = View.VISIBLE
                    binding.layoutStepper.visibility = View.GONE
                }
            }

            binding.root.contentDescription = buildString {
                append(item.name)
                append(", ₹${item.price}")
                if (item.hasModifiers) append(", customisable")
                if (!item.isAvailable) append(", out of stock")
            }
        }
    }

    private class DiffCallback : DiffUtil.ItemCallback<MenuItemWithQty>() {
        override fun areItemsTheSame(a: MenuItemWithQty, b: MenuItemWithQty) = a.item.id == b.item.id
        override fun areContentsTheSame(a: MenuItemWithQty, b: MenuItemWithQty) = a == b
    }
}
