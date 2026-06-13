package com.dajaj.pos.feature.pos.modifier

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.TextView
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.dajaj.pos.domain.model.SelectionType
import com.dajaj.pos.feature.pos.R

/**
 * RecyclerView adapter for displaying modifier groups in the modifier selection sheet.
 *
 * Dynamically renders:
 * - RadioButtons for single-selection groups (SelectionType.SINGLE)
 * - CheckBoxes for multiple-selection groups (SelectionType.MULTIPLE or NONE)
 *
 * Each modifier option displays the name and price adjustment (e.g., "+₹20").
 * Selection changes are reported via [onSelectionChanged] callback for validation.
 */
class ModifierGroupAdapter(
    private val onSelectionChanged: (groupId: String, selectedModifierIds: Set<String>) -> Unit
) : ListAdapter<ModifierGroupData, ModifierGroupAdapter.ModifierGroupViewHolder>(
    ModifierGroupDiffCallback()
) {

    /** Current selections per group. */
    private val selections: MutableMap<String, MutableSet<String>> = mutableMapOf()

    /** Validation state per group. */
    private val validationErrors: MutableMap<String, String?> = mutableMapOf()

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ModifierGroupViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_modifier_group, parent, false)
        return ModifierGroupViewHolder(view)
    }

    override fun onBindViewHolder(holder: ModifierGroupViewHolder, position: Int) {
        val group = getItem(position)
        holder.bind(group)
    }

    /**
     * Updates the validation error for a specific group.
     * Pass null to clear the error.
     */
    fun setValidationError(groupId: String, error: String?) {
        validationErrors[groupId] = error
        val position = currentList.indexOfFirst { it.id == groupId }
        if (position >= 0) {
            notifyItemChanged(position)
        }
    }

    /**
     * Returns all currently selected modifier IDs for a given group.
     */
    fun getSelectionsForGroup(groupId: String): Set<String> {
        return selections[groupId] ?: emptySet()
    }

    inner class ModifierGroupViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {

        private val tvGroupName: TextView = itemView.findViewById(R.id.tvGroupName)
        private val tvSelectionType: TextView = itemView.findViewById(R.id.tvSelectionType)
        private val tvGroupValidation: TextView = itemView.findViewById(R.id.tvGroupValidation)
        private val llModifierOptions: LinearLayout = itemView.findViewById(R.id.llModifierOptions)

        fun bind(group: ModifierGroupData) {
            tvGroupName.text = group.name
            tvSelectionType.text = getSelectionTypeLabel(group)

            // Show/hide validation error
            val error = validationErrors[group.id]
            if (error != null) {
                tvGroupValidation.text = error
                tvGroupValidation.visibility = View.VISIBLE
            } else {
                tvGroupValidation.visibility = View.GONE
            }

            // Initialize selections for this group
            selections.getOrPut(group.id) { mutableSetOf() }

            // Clear and rebuild options
            llModifierOptions.removeAllViews()

            when (group.selectionType) {
                SelectionType.SINGLE -> buildRadioOptions(group)
                SelectionType.MULTIPLE -> buildCheckBoxOptions(group)
                SelectionType.NONE -> buildCheckBoxOptions(group)
            }
        }

        /**
         * Builds RadioButton options for single-selection groups.
         */
        private fun buildRadioOptions(group: ModifierGroupData) {
            val radioGroup = RadioGroup(itemView.context).apply {
                orientation = RadioGroup.VERTICAL
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                )
            }

            val currentSelection = selections[group.id]

            for (modifier in group.modifiers) {
                val radioButton = RadioButton(itemView.context).apply {
                    id = View.generateViewId()
                    text = formatModifierLabel(modifier)
                    tag = modifier.id
                    minHeight = itemView.resources.getDimensionPixelSize(R.dimen.touch_target_min)
                    isChecked = currentSelection?.contains(modifier.id) == true
                    contentDescription = buildString {
                        append(modifier.name)
                        if (modifier.price > 0) append(", plus ₹${modifier.price.toInt()}")
                    }
                }
                radioGroup.addView(radioButton)
            }

            radioGroup.setOnCheckedChangeListener { rg, checkedId ->
                val selectedView = rg.findViewById<RadioButton>(checkedId)
                val modifierId = selectedView?.tag as? String ?: return@setOnCheckedChangeListener
                selections[group.id] = mutableSetOf(modifierId)
                onSelectionChanged(group.id, selections[group.id]!!)
            }

            llModifierOptions.addView(radioGroup)
        }

        /**
         * Builds CheckBox options for multiple-selection groups.
         */
        private fun buildCheckBoxOptions(group: ModifierGroupData) {
            val currentSelection = selections[group.id]

            for (modifier in group.modifiers) {
                val checkBox = CheckBox(itemView.context).apply {
                    text = formatModifierLabel(modifier)
                    tag = modifier.id
                    minHeight = itemView.resources.getDimensionPixelSize(R.dimen.touch_target_min)
                    isChecked = currentSelection?.contains(modifier.id) == true
                    contentDescription = buildString {
                        append(modifier.name)
                        if (modifier.price > 0) append(", plus ₹${modifier.price.toInt()}")
                    }
                }

                checkBox.setOnCheckedChangeListener { _, isChecked ->
                    val currentSet = selections.getOrPut(group.id) { mutableSetOf() }
                    if (isChecked) {
                        // Enforce max selection
                        if (group.maxSelection > 0 && currentSet.size >= group.maxSelection) {
                            checkBox.isChecked = false
                            return@setOnCheckedChangeListener
                        }
                        currentSet.add(modifier.id)
                    } else {
                        currentSet.remove(modifier.id)
                    }
                    onSelectionChanged(group.id, currentSet)
                }

                llModifierOptions.addView(checkBox)
            }
        }

        /**
         * Formats modifier label with price adjustment.
         */
        private fun formatModifierLabel(modifier: ModifierData): String {
            return if (modifier.price > 0) {
                "${modifier.name} (+₹${modifier.price.toInt()})"
            } else {
                modifier.name
            }
        }

        /**
         * Returns a human-readable label for the selection type.
         */
        private fun getSelectionTypeLabel(group: ModifierGroupData): String {
            return when {
                group.selectionType == SelectionType.SINGLE -> "Choose 1"
                group.minSelection > 0 && group.maxSelection > 0 ->
                    "Choose ${group.minSelection}–${group.maxSelection}"
                group.minSelection > 0 -> "Choose at least ${group.minSelection}"
                group.maxSelection > 0 -> "Choose up to ${group.maxSelection}"
                else -> "Optional"
            }
        }
    }

    private class ModifierGroupDiffCallback : DiffUtil.ItemCallback<ModifierGroupData>() {
        override fun areItemsTheSame(
            oldItem: ModifierGroupData,
            newItem: ModifierGroupData
        ): Boolean = oldItem.id == newItem.id

        override fun areContentsTheSame(
            oldItem: ModifierGroupData,
            newItem: ModifierGroupData
        ): Boolean = oldItem == newItem
    }
}
