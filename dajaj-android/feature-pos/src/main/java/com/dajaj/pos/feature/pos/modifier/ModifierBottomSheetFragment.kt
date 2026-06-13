package com.dajaj.pos.feature.pos.modifier

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.TextView
import androidx.fragment.app.FragmentManager
import com.dajaj.pos.domain.model.MenuItem
import com.dajaj.pos.domain.model.SelectionType
import com.dajaj.pos.feature.pos.R
import com.dajaj.pos.feature.pos.databinding.FragmentModifierSheetBinding
import com.dajaj.pos.feature.pos.model.ModifierSelection
import com.google.android.material.bottomsheet.BottomSheetDialogFragment

/**
 * BottomSheet dialog for selecting modifiers when adding an item to the cart.
 *
 * Displays modifier groups belonging to the selected menu item, with:
 * - RadioButtons for single-selection groups
 * - CheckBoxes for multiple-selection groups
 * - Price adjustment display per modifier
 * - Min/max selection enforcement per group
 * - "Add to Cart" button enabled only when all required selections are valid
 *
 * Results are returned to the caller via [ModifierSelectionListener].
 */
class ModifierBottomSheetFragment : BottomSheetDialogFragment() {

    private var _binding: FragmentModifierSheetBinding? = null
    private val binding get() = _binding!!

    /** The menu item being modified. */
    private var menuItemName: String = ""
    private var menuItemId: String = ""

    /** Modifier groups and their child modifiers. */
    private var modifierGroups: List<ModifierGroupData> = emptyList()

    /** Current selections per group (groupId → set of modifier IDs). */
    private val selections: MutableMap<String, MutableSet<String>> = mutableMapOf()

    /** Listener for returning selected modifiers to the caller. */
    private var listener: ModifierSelectionListener? = null

    /** View references for group validation indicators. */
    private val groupValidationViews: MutableMap<String, TextView> = mutableMapOf()

    /**
     * Listener interface for receiving modifier selection results.
     */
    interface ModifierSelectionListener {
        fun onModifiersSelected(menuItemId: String, modifiers: List<ModifierSelection>)
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentModifierSheetBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        binding.tvModifierTitle.text = menuItemName
        buildModifierGroupViews()
        setupAddToCartButton()
        validateAllGroups()
    }

    /**
     * Dynamically builds the modifier group views (inflating item_modifier_group layout).
     * For each group, creates either a RadioGroup (single selection) or CheckBox list (multiple).
     */
    private fun buildModifierGroupViews() {
        val container = binding.llModifierGroups
        container.removeAllViews()

        for (group in modifierGroups) {
            val groupView = LayoutInflater.from(requireContext())
                .inflate(R.layout.item_modifier_group, container, false)

            val tvGroupName = groupView.findViewById<TextView>(R.id.tvGroupName)
            val tvSelectionType = groupView.findViewById<TextView>(R.id.tvSelectionType)
            val tvGroupValidation = groupView.findViewById<TextView>(R.id.tvGroupValidation)
            val llModifierOptions = groupView.findViewById<LinearLayout>(R.id.llModifierOptions)

            tvGroupName.text = group.name
            tvSelectionType.text = getSelectionTypeLabel(group)
            groupValidationViews[group.id] = tvGroupValidation

            // Initialize empty selection set for this group
            selections[group.id] = mutableSetOf()

            when (group.selectionType) {
                SelectionType.SINGLE -> buildRadioGroup(llModifierOptions, group)
                SelectionType.MULTIPLE -> buildCheckBoxGroup(llModifierOptions, group)
                SelectionType.NONE -> buildCheckBoxGroup(llModifierOptions, group)
            }

            container.addView(groupView)
        }
    }

    /**
     * Builds a RadioGroup for single-selection modifier groups.
     */
    private fun buildRadioGroup(container: LinearLayout, group: ModifierGroupData) {
        val radioGroup = RadioGroup(requireContext()).apply {
            orientation = RadioGroup.VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }

        for (modifier in group.modifiers) {
            val radioButton = RadioButton(requireContext()).apply {
                id = View.generateViewId()
                text = formatModifierLabel(modifier)
                tag = modifier.id
                minHeight = resources.getDimensionPixelSize(R.dimen.touch_target_min)
                setPadding(
                    resources.getDimensionPixelSize(R.dimen.padding_sm), 0,
                    resources.getDimensionPixelSize(R.dimen.padding_sm), 0
                )
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
            validateAllGroups()
        }

        container.addView(radioGroup)
    }

    /**
     * Builds CheckBox views for multiple-selection modifier groups.
     */
    private fun buildCheckBoxGroup(container: LinearLayout, group: ModifierGroupData) {
        for (modifier in group.modifiers) {
            val checkBox = CheckBox(requireContext()).apply {
                text = formatModifierLabel(modifier)
                tag = modifier.id
                minHeight = resources.getDimensionPixelSize(R.dimen.touch_target_min)
                setPadding(
                    resources.getDimensionPixelSize(R.dimen.padding_sm), 0,
                    resources.getDimensionPixelSize(R.dimen.padding_sm), 0
                )
                contentDescription = buildString {
                    append(modifier.name)
                    if (modifier.price > 0) append(", plus ₹${modifier.price.toInt()}")
                }
            }

            checkBox.setOnCheckedChangeListener { _, isChecked ->
                val currentSet = selections.getOrPut(group.id) { mutableSetOf() }
                if (isChecked) {
                    // Enforce max selection: uncheck this if at max
                    if (group.maxSelection > 0 && currentSet.size >= group.maxSelection) {
                        checkBox.isChecked = false
                        return@setOnCheckedChangeListener
                    }
                    currentSet.add(modifier.id)
                } else {
                    currentSet.remove(modifier.id)
                }
                validateAllGroups()
            }

            container.addView(checkBox)
        }
    }

    /**
     * Formats a modifier label showing name and price adjustment.
     * e.g., "Extra Spicy (+₹20)" or "No Onion"
     */
    private fun formatModifierLabel(modifier: ModifierData): String {
        return if (modifier.price > 0) {
            "${modifier.name} (+₹${modifier.price.toInt()})"
        } else {
            modifier.name
        }
    }

    /**
     * Returns a human-readable selection type label for the group header.
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

    /**
     * Validates all modifier groups and updates the "Add to Cart" button state.
     * Shows validation messages for groups that don't meet min selection requirements.
     */
    private fun validateAllGroups() {
        var allValid = true
        var firstInvalidMessage: String? = null

        for (group in modifierGroups) {
            val selectedCount = selections[group.id]?.size ?: 0
            val isValid = isGroupValid(group, selectedCount)

            // Update group-level validation indicator
            val validationView = groupValidationViews[group.id]
            if (!isValid && group.minSelection > 0) {
                val message = "Select at least ${group.minSelection}"
                validationView?.text = message
                validationView?.visibility = View.VISIBLE
                if (firstInvalidMessage == null) {
                    firstInvalidMessage = "$message in ${group.name}"
                }
                allValid = false
            } else {
                validationView?.visibility = View.GONE
            }
        }

        // Update global validation message and button state
        if (firstInvalidMessage != null) {
            binding.tvValidationMessage.text = firstInvalidMessage
            binding.tvValidationMessage.visibility = View.VISIBLE
        } else {
            binding.tvValidationMessage.visibility = View.GONE
        }

        binding.btnAddToCart.isEnabled = allValid
    }

    /**
     * Checks if a group's selection count meets its min/max constraints.
     */
    private fun isGroupValid(group: ModifierGroupData, selectedCount: Int): Boolean {
        if (group.minSelection > 0 && selectedCount < group.minSelection) return false
        if (group.maxSelection > 0 && selectedCount > group.maxSelection) return false
        return true
    }

    /**
     * Sets up the "Add to Cart" button click handler.
     * Collects all selections and returns them to the listener.
     */
    private fun setupAddToCartButton() {
        binding.btnAddToCart.setOnClickListener {
            val modifierSelections = buildModifierSelections()
            listener?.onModifiersSelected(menuItemId, modifierSelections)
            dismiss()
        }
    }

    /**
     * Builds the final list of [ModifierSelection] from the current selections map.
     */
    private fun buildModifierSelections(): List<ModifierSelection> {
        val result = mutableListOf<ModifierSelection>()

        for (group in modifierGroups) {
            val selectedIds = selections[group.id] ?: continue
            for (modifier in group.modifiers) {
                if (modifier.id in selectedIds) {
                    result.add(
                        ModifierSelection(
                            id = modifier.id,
                            name = modifier.name,
                            price = modifier.price,
                            groupName = group.name
                        )
                    )
                }
            }
        }

        return result
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
        groupValidationViews.clear()
    }

    companion object {
        private const val TAG = "ModifierBottomSheet"

        /**
         * Creates and shows a new ModifierBottomSheetFragment.
         *
         * @param fragmentManager The FragmentManager to show the dialog with
         * @param menuItem The domain [MenuItem] being modified (variant node)
         * @param modifierGroups The modifier groups belonging to this item, each
         *   paired with its child modifiers loaded from the menu tree
         * @param listener Callback for receiving the selected modifiers
         */
        fun show(
            fragmentManager: FragmentManager,
            menuItem: MenuItem,
            modifierGroups: List<Pair<MenuItem, List<MenuItem>>>,
            listener: ModifierSelectionListener
        ) {
            val fragment = ModifierBottomSheetFragment().apply {
                this.menuItemName = menuItem.name
                this.menuItemId = menuItem.id
                this.listener = listener
                this.modifierGroups = modifierGroups.map { (group, modifiers) ->
                    ModifierGroupData(
                        id = group.id,
                        name = group.name,
                        selectionType = group.selectionType,
                        minSelection = group.minSelection,
                        maxSelection = group.maxSelection,
                        modifiers = modifiers.map { mod ->
                            ModifierData(
                                id = mod.id,
                                name = mod.name,
                                price = mod.price
                            )
                        }
                    )
                }
            }
            fragment.show(fragmentManager, TAG)
        }
    }
}
