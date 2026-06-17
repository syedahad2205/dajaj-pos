package com.dajaj.pos.feature.pos

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.AutoCompleteTextView
import android.widget.LinearLayout
import androidx.core.view.isVisible
import androidx.core.widget.doAfterTextChanged
import androidx.fragment.app.FragmentManager
import com.dajaj.pos.common.extensions.toRupees
import com.dajaj.pos.domain.model.PaymentMethod
import com.dajaj.pos.domain.model.PaymentInfo
import com.dajaj.pos.domain.model.PaymentSplit
import com.dajaj.pos.feature.pos.databinding.FragmentPaymentSheetBinding
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout

/**
 * Bottom sheet dialog for selecting payment method and entering amounts.
 *
 * Supports:
 * - Cash: Input cash collected, auto-calculates change
 * - Card: No additional input needed
 * - UPI: No additional input needed
 * - Mixed: Up to 4 split entries with method + amount, sum must equal grand total
 *
 * Returns [PaymentInfo] via [PaymentSelectionListener] when confirmed.
 *
 * @see <a href="requirements.md">Requirements 5.8, 16.1, 16.2, 16.3, 16.4, 16.5</a>
 */
class PaymentBottomSheetFragment : BottomSheetDialogFragment() {

    private var _binding: FragmentPaymentSheetBinding? = null
    private val binding get() = _binding!!

    private var grandTotal: Double = 0.0
    private var listener: PaymentSelectionListener? = null
    private var selectedMethod: PaymentMethod = PaymentMethod.CASH

    /** Tracks mixed payment split views (method spinner + amount input). */
    private val splitViews = mutableListOf<SplitViewHolder>()

    interface PaymentSelectionListener {
        fun onPaymentConfirmed(paymentInfo: PaymentInfo)
        fun onPaymentCancelled()
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentPaymentSheetBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        grandTotal = arguments?.getDouble(ARG_GRAND_TOTAL, 0.0) ?: 0.0
        binding.tvGrandTotal.text = grandTotal.toRupees()

        setupPaymentMethodChips()
        setupCashInput()
        setupMixedPayment()
        setupActionButtons()

        // Default: cash selected, pre-fill grand total as suggestion
        updatePaymentMethodVisibility(PaymentMethod.CASH)
        validateCurrentState()
    }

    private fun setupPaymentMethodChips() {
        binding.chipGroupPayment.setOnCheckedStateChangeListener { _, checkedIds ->
            if (checkedIds.isEmpty()) return@setOnCheckedStateChangeListener

            selectedMethod = when (checkedIds.first()) {
                binding.chipCash.id -> PaymentMethod.CASH
                binding.chipCard.id -> PaymentMethod.CARD
                binding.chipUpi.id -> PaymentMethod.UPI
                binding.chipMixed.id -> PaymentMethod.MIXED
                else -> PaymentMethod.CASH
            }

            updatePaymentMethodVisibility(selectedMethod)
            validateCurrentState()
        }
    }

    private fun updatePaymentMethodVisibility(method: PaymentMethod) {
        binding.layoutCashPayment.isVisible = method == PaymentMethod.CASH
        binding.layoutMixedPayment.isVisible = method == PaymentMethod.MIXED

        // For Card/UPI, always valid (no additional input needed)
        if (method == PaymentMethod.CARD || method == PaymentMethod.UPI) {
            binding.btnConfirmPayment.isEnabled = true
            binding.tvPaymentError.isVisible = false
        }
    }

    private fun setupCashInput() {
        binding.etCashCollected.doAfterTextChanged { text ->
            val cashCollected = text?.toString()?.toDoubleOrNull()
            if (cashCollected != null && cashCollected >= grandTotal) {
                val change = cashCollected - grandTotal
                binding.layoutChange.isVisible = true
                binding.tvChange.text = change.toRupees()
                binding.tvPaymentError.isVisible = false
            } else {
                binding.layoutChange.isVisible = false
                if (cashCollected != null && cashCollected < grandTotal) {
                    binding.tvPaymentError.text = "Cash must be ≥ ${grandTotal.toRupees()}"
                    binding.tvPaymentError.isVisible = true
                } else {
                    binding.tvPaymentError.isVisible = false
                }
            }
            validateCurrentState()
        }
    }

    private fun setupMixedPayment() {
        // Add initial two splits
        addSplitEntry(PaymentMethod.CASH)
        addSplitEntry(PaymentMethod.CARD)

        binding.btnAddSplit.setOnClickListener {
            if (splitViews.size >= MAX_SPLITS) {
                binding.tvPaymentError.text = getString(
                    com.dajaj.pos.feature.pos.R.string.payment_max_splits_reached
                )
                binding.tvPaymentError.isVisible = true
                return@setOnClickListener
            }
            addSplitEntry(PaymentMethod.UPI)
            updateAddSplitButton()
            validateCurrentState()
        }
    }

    private fun addSplitEntry(defaultMethod: PaymentMethod) {
        val context = requireContext()

        val entryLayout = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = 8.dpToPx()
            }
        }

        // Method dropdown
        val methodLayout = TextInputLayout(
            context,
            null,
            com.google.android.material.R.attr.textInputOutlinedExposedDropdownMenuStyle
        ).apply {
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginEnd = 8.dpToPx()
            }
            hint = getString(com.dajaj.pos.feature.pos.R.string.payment_select_method)
        }

        val methods = arrayOf("Cash", "Card", "UPI")
        val methodDropdown = AutoCompleteTextView(context).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            setAdapter(ArrayAdapter(context, android.R.layout.simple_dropdown_item_1line, methods))
            setText(defaultMethod.toDisplayString(), false)
            inputType = 0 // Non-editable
        }
        methodLayout.addView(methodDropdown)

        // Amount input
        val amountLayout = TextInputLayout(context, null, com.google.android.material.R.attr.textInputOutlinedStyle).apply {
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            hint = getString(com.dajaj.pos.feature.pos.R.string.payment_split_amount_hint)
            prefixText = "₹"
        }

        val amountInput = TextInputEditText(context).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL
            contentDescription = "Split amount for ${defaultMethod.toDisplayString()}"
        }
        amountInput.doAfterTextChanged { validateCurrentState() }
        amountLayout.addView(amountInput)

        entryLayout.addView(methodLayout)
        entryLayout.addView(amountLayout)
        binding.layoutSplitEntries.addView(entryLayout)

        splitViews.add(SplitViewHolder(entryLayout, methodDropdown, amountInput))
    }

    private fun updateAddSplitButton() {
        binding.btnAddSplit.isEnabled = splitViews.size < MAX_SPLITS
    }

    private fun validateCurrentState() {
        val isValid = when (selectedMethod) {
            PaymentMethod.CASH -> {
                val cash = binding.etCashCollected.text?.toString()?.toDoubleOrNull()
                cash != null && cash >= grandTotal
            }
            PaymentMethod.CARD, PaymentMethod.UPI -> true
            PaymentMethod.MIXED -> {
                val splits = getSplitAmounts()
                if (splits.isEmpty() || splits.any { it.amount <= 0 }) {
                    false
                } else {
                    val sum = splits.sumOf { it.amount }
                    val rounded = Math.round(sum * 100.0) / 100.0
                    val roundedTotal = Math.round(grandTotal * 100.0) / 100.0
                    rounded == roundedTotal
                }
            }
        }

        binding.btnConfirmPayment.isEnabled = isValid

        // Update remaining amount for mixed
        if (selectedMethod == PaymentMethod.MIXED) {
            val splits = getSplitAmounts()
            val sum = splits.sumOf { it.amount }
            val remaining = grandTotal - sum
            binding.tvRemaining.text = remaining.toRupees()
            binding.tvRemaining.setTextColor(
                if (remaining == 0.0) {
                    requireContext().getColor(com.google.android.material.R.color.material_on_surface_emphasis_medium)
                } else {
                    requireContext().getColor(com.google.android.material.R.color.design_default_color_error)
                }
            )
        }
    }

    private fun getSplitAmounts(): List<PaymentSplit> {
        return splitViews.mapNotNull { holder ->
            val method = parseMethod(holder.methodDropdown.text.toString())
            val amount = holder.amountInput.text?.toString()?.toDoubleOrNull() ?: 0.0
            if (amount > 0) PaymentSplit(method, amount) else null
        }
    }

    private fun parseMethod(text: String): PaymentMethod = when (text.lowercase()) {
        "cash" -> PaymentMethod.CASH
        "card" -> PaymentMethod.CARD
        "upi" -> PaymentMethod.UPI
        else -> PaymentMethod.CASH
    }

    private fun setupActionButtons() {
        binding.btnCancelPayment.setOnClickListener {
            listener?.onPaymentCancelled()
            dismiss()
        }

        binding.btnConfirmPayment.setOnClickListener {
            val paymentInfo = buildPaymentInfo() ?: return@setOnClickListener
            listener?.onPaymentConfirmed(paymentInfo)
            dismiss()
        }
    }

    private fun buildPaymentInfo(): PaymentInfo? {
        return when (selectedMethod) {
            PaymentMethod.CASH -> {
                val cash = binding.etCashCollected.text?.toString()?.toDoubleOrNull()
                    ?: return null
                PaymentInfo(
                    method = PaymentMethod.CASH,
                    cashCollected = cash,
                    splits = null
                )
            }
            PaymentMethod.CARD -> PaymentInfo(
                method = PaymentMethod.CARD,
                cashCollected = null,
                splits = null
            )
            PaymentMethod.UPI -> PaymentInfo(
                method = PaymentMethod.UPI,
                cashCollected = null,
                splits = null
            )
            PaymentMethod.MIXED -> {
                val splits = getSplitAmounts()
                PaymentInfo(
                    method = PaymentMethod.MIXED,
                    cashCollected = null,
                    splits = splits
                )
            }
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
        splitViews.clear()
    }

    private fun Int.dpToPx(): Int {
        return (this * resources.displayMetrics.density).toInt()
    }

    private fun PaymentMethod.toDisplayString(): String = when (this) {
        PaymentMethod.CASH -> "Cash"
        PaymentMethod.CARD -> "Card"
        PaymentMethod.UPI -> "UPI"
        PaymentMethod.MIXED -> "Mixed"
    }

    /**
     * Holds references to the views for a single split entry row.
     */
    private data class SplitViewHolder(
        val layout: LinearLayout,
        val methodDropdown: AutoCompleteTextView,
        val amountInput: TextInputEditText
    )

    companion object {
        private const val TAG = "PaymentBottomSheet"
        private const val ARG_GRAND_TOTAL = "arg_grand_total"
        private const val MAX_SPLITS = 4

        /**
         * Shows the payment bottom sheet dialog.
         *
         * @param fragmentManager The fragment manager to use for showing the dialog
         * @param grandTotal The grand total amount to display and validate against
         * @param listener Callback for payment confirmation or cancellation
         */
        fun show(
            fragmentManager: FragmentManager,
            grandTotal: Double,
            listener: PaymentSelectionListener
        ) {
            val fragment = PaymentBottomSheetFragment().apply {
                arguments = Bundle().apply {
                    putDouble(ARG_GRAND_TOTAL, grandTotal)
                }
                this.listener = listener
            }
            fragment.show(fragmentManager, TAG)
        }
    }
}
