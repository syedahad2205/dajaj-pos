package com.dajaj.pos.feature.reports

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.recyclerview.widget.LinearLayoutManager
import com.dajaj.pos.feature.reports.databinding.FragmentReportsBinding
import com.google.android.material.datepicker.MaterialDatePicker
import com.google.android.material.snackbar.Snackbar
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Fragment displaying daily sales reports on the Android POS.
 *
 * Features:
 * - Date picker defaulting to today
 * - Summary card: total orders, total revenue, average order value
 * - Channel breakdown: Walk-in, WhatsApp, Website counts and revenue
 * - Peak hour indicator (1-hour slot with highest order count)
 * - Bill list for selected date (minimal)
 * - Empty state when no data available
 *
 * Requirements: 13.1, 13.4
 */
@AndroidEntryPoint
class ReportsFragment : Fragment() {

    private var _binding: FragmentReportsBinding? = null
    private val binding get() = _binding!!

    private val viewModel: ReportsViewModel by viewModels()

    private var billAdapter: BillListAdapter? = null

    private val dateFormat = SimpleDateFormat("dd MMM yyyy", Locale.getDefault())
    private val currencyFormat = NumberFormat.getCurrencyInstance(Locale("en", "IN"))

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentReportsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        setupDatePicker()
        setupBillList()
        observeUiState()
    }

    /**
     * Sets up the date picker button. Defaults to today's date.
     * Opens a Material Date Picker on tap.
     */
    private fun setupDatePicker() {
        binding.btnDatePicker.text = dateFormat.format(Date())

        binding.btnDatePicker.setOnClickListener {
            val datePicker = MaterialDatePicker.Builder.datePicker()
                .setTitleText(getString(R.string.reports_select_date))
                .setSelection(viewModel.uiState.value.selectedDate.time)
                .build()

            datePicker.addOnPositiveButtonClickListener { selection ->
                // MaterialDatePicker returns UTC midnight, convert to local date
                val selectedDate = Date(selection)
                binding.btnDatePicker.text = dateFormat.format(selectedDate)
                viewModel.loadReport(selectedDate)
            }

            datePicker.show(parentFragmentManager, "DATE_PICKER")
        }
    }

    /**
     * Sets up the bill list RecyclerView with the adapter.
     */
    private fun setupBillList() {
        billAdapter = BillListAdapter()
        binding.rvBills.apply {
            layoutManager = LinearLayoutManager(requireContext())
            adapter = billAdapter
            isNestedScrollingEnabled = false
        }
    }

    /**
     * Observes the ViewModel UI state and updates the view accordingly.
     */
    private fun observeUiState() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.uiState.collect { state ->
                    // Loading state
                    binding.progressLoading.visibility =
                        if (state.isLoading) View.VISIBLE else View.GONE

                    // Error handling
                    if (state.error != null) {
                        Snackbar.make(binding.root, state.error, Snackbar.LENGTH_LONG).show()
                    }

                    // Empty state vs content visibility
                    if (state.isEmpty && !state.isLoading) {
                        binding.layoutEmptyState.visibility = View.VISIBLE
                        binding.scrollContent.visibility = View.GONE
                    } else if (!state.isLoading) {
                        binding.layoutEmptyState.visibility = View.GONE
                        binding.scrollContent.visibility = View.VISIBLE
                        bindSummary(state)
                        bindChannelBreakdown(state.channelBreakdown)
                        bindPeakHour(state.peakHour)
                        bindBillList(state.bills)
                    }
                }
            }
        }
    }

    /**
     * Binds summary metrics to the summary card.
     */
    private fun bindSummary(state: ReportsUiState) {
        binding.tvTotalOrders.text = state.totalOrders.toString()
        binding.tvTotalRevenue.text = formatCurrency(state.totalRevenue)
        binding.tvAvgOrderValue.text = formatCurrency(state.avgOrderValue)
    }

    /**
     * Binds channel breakdown data to the channel breakdown card.
     */
    private fun bindChannelBreakdown(breakdown: ChannelBreakdown) {
        binding.tvWalkinCount.text = getString(R.string.reports_order_count, breakdown.walkinCount)
        binding.tvWalkinRevenue.text = formatCurrency(breakdown.walkinRevenue)

        binding.tvWhatsappCount.text = getString(R.string.reports_order_count, breakdown.whatsappCount)
        binding.tvWhatsappRevenue.text = formatCurrency(breakdown.whatsappRevenue)

        binding.tvWebsiteCount.text = getString(R.string.reports_order_count, breakdown.websiteCount)
        binding.tvWebsiteRevenue.text = formatCurrency(breakdown.websiteRevenue)
    }

    /**
     * Binds peak hour data to the peak hour card.
     * Hides the card if no peak hour data is available.
     */
    private fun bindPeakHour(peakHour: PeakHour?) {
        if (peakHour != null) {
            binding.cardPeakHour.visibility = View.VISIBLE
            binding.tvPeakHourSlot.text = peakHour.slotLabel
            binding.tvPeakHourCount.text = peakHour.orderCount.toString()
        } else {
            binding.cardPeakHour.visibility = View.GONE
        }
    }

    /**
     * Binds bill list data to the RecyclerView.
     * Hides the card if the list is empty.
     */
    private fun bindBillList(bills: List<BillItem>) {
        if (bills.isNotEmpty()) {
            binding.cardBillList.visibility = View.VISIBLE
            billAdapter?.submitList(bills)
        } else {
            binding.cardBillList.visibility = View.GONE
        }
    }

    /**
     * Formats a Double value as Indian Rupee currency (₹X,XXX).
     */
    private fun formatCurrency(amount: Double): String {
        return currencyFormat.format(amount)
    }

    override fun onDestroyView() {
        super.onDestroyView()
        binding.rvBills.adapter = null
        billAdapter = null
        _binding = null
    }
}
