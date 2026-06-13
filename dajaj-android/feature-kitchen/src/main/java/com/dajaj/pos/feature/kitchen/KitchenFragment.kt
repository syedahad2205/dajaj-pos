package com.dajaj.pos.feature.kitchen

import android.media.MediaPlayer
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
import com.dajaj.pos.feature.kitchen.databinding.FragmentKitchenBinding
import com.google.android.material.snackbar.Snackbar
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch

/**
 * Fragment displaying the kitchen preparation queue.
 *
 * Features:
 * - Header showing count of orders currently in PREPARING state
 * - RecyclerView with kitchen order cards sorted FIFO (oldest first by preparingAt)
 * - Each card shows: order number, items with quantities, special notes,
 *   elapsed timer (updates every second), overdue indicator (red border + badge)
 * - "Mark Ready" button per card to transition order to READY state
 * - Audio alert when an order is marked ready (Requirement 11.4)
 * - Real-time Firestore listener for live updates
 * - Empty state: "Kitchen is clear. New orders will appear when accepted."
 */
@AndroidEntryPoint
class KitchenFragment : Fragment() {

    private var _binding: FragmentKitchenBinding? = null
    private val binding get() = _binding!!

    private val viewModel: KitchenViewModel by viewModels()

    private var adapter: KitchenAdapter? = null
    private var mediaPlayer: MediaPlayer? = null

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentKitchenBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        setupRecyclerView()
        observeUiState()
        observeEvents()
    }

    /**
     * Initializes the RecyclerView with the kitchen adapter.
     */
    private fun setupRecyclerView() {
        adapter = KitchenAdapter(
            onMarkReadyClick = { order ->
                viewModel.markReady(order.id, order.orderNumber)
            }
        )
        binding.rvKitchenOrders.apply {
            layoutManager = LinearLayoutManager(requireContext())
            adapter = this@KitchenFragment.adapter
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
                    adapter?.submitList(state.orders)

                    // Header preparing count
                    binding.tvPreparingCount.text = when (state.preparingCount) {
                        0 -> ""
                        1 -> getString(R.string.kitchen_preparing_count_single)
                        else -> getString(R.string.kitchen_preparing_count, state.preparingCount)
                    }

                    // Empty state vs content visibility
                    if (state.isEmpty) {
                        binding.layoutEmptyState.visibility = View.VISIBLE
                        binding.rvKitchenOrders.visibility = View.GONE
                    } else {
                        binding.layoutEmptyState.visibility = View.GONE
                        binding.rvKitchenOrders.visibility = View.VISIBLE
                    }
                }
            }
        }
    }

    /**
     * Observes one-shot events from the ViewModel (audio alerts, snackbar messages).
     */
    private fun observeEvents() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.events.collect { event ->
                    when (event) {
                        is KitchenEvent.OrderMarkedReady -> {
                            // Play audio alert
                            playReadyAlert()
                            // Show success snackbar
                            Snackbar.make(
                                binding.root,
                                getString(R.string.kitchen_mark_ready_success, event.orderNumber),
                                Snackbar.LENGTH_SHORT
                            ).show()
                        }
                        is KitchenEvent.ShowError -> {
                            Snackbar.make(
                                binding.root,
                                event.message,
                                Snackbar.LENGTH_LONG
                            ).show()
                        }
                    }
                }
            }
        }
    }

    /**
     * Plays an audio alert when an order is marked ready.
     * Uses the system notification sound as the alert.
     */
    private fun playReadyAlert() {
        try {
            releaseMediaPlayer()
            val notificationUri = android.media.RingtoneManager.getDefaultUri(
                android.media.RingtoneManager.TYPE_NOTIFICATION
            )
            mediaPlayer = MediaPlayer().apply {
                setDataSource(requireContext(), notificationUri)
                setOnCompletionListener { mp ->
                    mp.release()
                    if (this@KitchenFragment.mediaPlayer === mp) {
                        this@KitchenFragment.mediaPlayer = null
                    }
                }
                prepare()
                start()
            }
        } catch (e: Exception) {
            // Gracefully handle audio playback failure — not critical
        }
    }

    /**
     * Releases the MediaPlayer if it's currently active.
     */
    private fun releaseMediaPlayer() {
        try {
            mediaPlayer?.release()
        } catch (e: Exception) {
            // Ignore release errors
        }
        mediaPlayer = null
    }

    override fun onDestroyView() {
        super.onDestroyView()
        releaseMediaPlayer()
        binding.rvKitchenOrders.adapter = null
        adapter = null
        _binding = null
    }
}
