package com.dajaj.pos.feature.pendingorders

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
import com.dajaj.pos.domain.model.PendingOrder
import com.dajaj.pos.feature.pendingorders.databinding.FragmentPendingOrdersBinding
import com.dajaj.pos.feature.pendingorders.model.ChannelTab
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.snackbar.Snackbar
import com.google.android.material.tabs.TabLayout
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch

/**
 * Fragment displaying pending orders from all channels (WhatsApp, Website, QR).
 *
 * Features:
 * - Tab bar filtering by channel (All / WhatsApp / Website / QR)
 * - RecyclerView with order cards showing source, customer, items, total, elapsed time
 * - Accept (green) and Reject (red) buttons per card
 * - Pull-to-refresh for manual data refresh
 * - Real-time update indicator
 * - Connectivity warning banner (shown within 5s of Firestore listener disconnect)
 * - Empty state when no orders exist
 * - Rejection reason dialog (1-200 chars)
 */
@AndroidEntryPoint
class PendingOrdersFragment : Fragment() {

    private var _binding: FragmentPendingOrdersBinding? = null
    private val binding get() = _binding!!

    private val viewModel: PendingOrdersViewModel by viewModels()

    private var adapter: PendingOrdersAdapter? = null

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentPendingOrdersBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        setupRecyclerView()
        setupTabLayout()
        setupSwipeRefresh()
        observeUiState()
        observeEvents()
    }

    /**
     * Initializes the RecyclerView with the pending orders adapter.
     */
    private fun setupRecyclerView() {
        adapter = PendingOrdersAdapter(
            onAcceptClick = { order -> viewModel.acceptOrder(order) },
            onRejectClick = { order -> showRejectionDialog(order) },
            onCardClick = { /* Expand details - future enhancement */ }
        )
        binding.rvPendingOrders.apply {
            layoutManager = LinearLayoutManager(requireContext())
            adapter = this@PendingOrdersFragment.adapter
        }
    }

    /**
     * Sets up tab layout listener for channel filtering.
     */
    private fun setupTabLayout() {
        binding.tabLayout.addOnTabSelectedListener(object : TabLayout.OnTabSelectedListener {
            override fun onTabSelected(tab: TabLayout.Tab?) {
                val channelTab = when (tab?.position) {
                    0 -> ChannelTab.ALL
                    1 -> ChannelTab.WHATSAPP
                    2 -> ChannelTab.WEBSITE
                    3 -> ChannelTab.QR
                    else -> ChannelTab.ALL
                }
                viewModel.selectTab(channelTab)
            }

            override fun onTabUnselected(tab: TabLayout.Tab?) {}
            override fun onTabReselected(tab: TabLayout.Tab?) {}
        })
    }

    /**
     * Sets up pull-to-refresh to trigger a data refresh.
     */
    private fun setupSwipeRefresh() {
        binding.swipeRefresh.setOnRefreshListener {
            viewModel.refresh()
        }
    }

    /**
     * Observes the ViewModel UI state and updates the view accordingly.
     */
    private fun observeUiState() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.uiState.collect { state ->
                    // Update order list
                    adapter?.submitList(state.filteredOrders)

                    // Empty state visibility
                    binding.tvEmptyState.visibility =
                        if (state.isEmpty) View.VISIBLE else View.GONE
                    binding.rvPendingOrders.visibility =
                        if (state.isEmpty) View.GONE else View.VISIBLE

                    // Refresh indicator
                    binding.swipeRefresh.isRefreshing = state.isRefreshing

                    // Connectivity warning banner
                    binding.bannerConnectivity.visibility =
                        if (!state.isConnected) View.VISIBLE else View.GONE

                    // Real-time indicator
                    binding.tvRealtimeIndicator.visibility =
                        if (state.isConnected && !state.isEmpty) View.VISIBLE else View.GONE
                }
            }
        }
    }

    /**
     * Observes one-shot events from the ViewModel (snackbar messages).
     */
    private fun observeEvents() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.events.collect { event ->
                    when (event) {
                        is PendingOrdersEvent.ShowMessage -> {
                            Snackbar.make(binding.root, event.message, Snackbar.LENGTH_SHORT)
                                .show()
                        }
                        is PendingOrdersEvent.ShowError -> {
                            Snackbar.make(binding.root, event.message, Snackbar.LENGTH_LONG)
                                .show()
                        }
                    }
                }
            }
        }
    }

    /**
     * Shows the rejection reason dialog. Validates that the reason is 1-200 characters
     * before submitting.
     */
    private fun showRejectionDialog(order: PendingOrder) {
        val dialogView = LayoutInflater.from(requireContext())
            .inflate(R.layout.dialog_rejection_reason, null)

        val tilReason = dialogView.findViewById<TextInputLayout>(R.id.tilRejectionReason)
        val etReason = dialogView.findViewById<TextInputEditText>(R.id.etRejectionReason)

        val dialog = MaterialAlertDialogBuilder(requireContext())
            .setTitle(R.string.pending_rejection_dialog_title)
            .setMessage(R.string.pending_rejection_dialog_message)
            .setView(dialogView)
            .setPositiveButton(R.string.pending_rejection_confirm, null)
            .setNegativeButton(R.string.pending_rejection_cancel, null)
            .create()

        dialog.show()

        // Override positive button to validate before dismiss
        dialog.getButton(android.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener {
            val reason = etReason?.text?.toString()?.trim() ?: ""

            if (reason.isEmpty()) {
                tilReason?.error = getString(R.string.pending_rejection_error_empty)
                return@setOnClickListener
            }

            tilReason?.error = null
            viewModel.rejectOrder(order.id, reason)
            dialog.dismiss()
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        binding.rvPendingOrders.adapter = null
        adapter = null
        _binding = null
    }
}
