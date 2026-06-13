package com.dajaj.pos.ui.main.dashboard

import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.navigation.fragment.findNavController
import com.dajaj.pos.R
import com.dajaj.pos.common.network.ConnectivityState
import com.dajaj.pos.databinding.FragmentDashboardBinding
import com.dajaj.pos.ui.R as CoreUiR
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@AndroidEntryPoint
class DashboardFragment : Fragment() {

    private var _binding: FragmentDashboardBinding? = null
    private val binding get() = _binding!!

    private val viewModel: DashboardViewModel by viewModels()

    private val dateTimeHandler = Handler(Looper.getMainLooper())
    private val dateTimeFormat = SimpleDateFormat("dd MMM yyyy, hh:mm a", Locale.getDefault())

    private val dateTimeRunnable = object : Runnable {
        override fun run() {
            _binding?.tvDateTime?.text = dateTimeFormat.format(Date())
            dateTimeHandler.postDelayed(this, 60_000L) // Update every minute
        }
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentDashboardBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        setupClickListeners()
        observeViewModel()
        startDateTimeUpdates()
    }

    private fun setupClickListeners() {
        binding.cardNewOrder.setOnClickListener {
            findNavController().navigate(R.id.action_dashboard_to_pos)
        }
        binding.cardPendingOrders.setOnClickListener {
            findNavController().navigate(R.id.action_dashboard_to_pendingOrders)
        }
        binding.cardKitchen.setOnClickListener {
            findNavController().navigate(R.id.action_dashboard_to_kitchen)
        }
        binding.cardReports.setOnClickListener {
            findNavController().navigate(R.id.action_dashboard_to_reports)
        }
        binding.cardSettings.setOnClickListener {
            findNavController().navigate(R.id.action_dashboard_to_settings)
        }
        binding.cardBills.setOnClickListener {
            findNavController().navigate(R.id.action_dashboard_to_bills)
        }
    }

    private fun observeViewModel() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch { observeConnectivity() }
                launch { observePrinterStatus() }
                launch { observePendingCount() }
                launch { observePreparingCount() }
                launch { observeCashierName() }
                launch { observeDeviceName() }
            }
        }
    }

    private suspend fun observeConnectivity() {
        viewModel.connectivityState.collect { state ->
            val context = context ?: return@collect
            when (state) {
                ConnectivityState.ONLINE -> {
                    setDotColor(binding.dotInternet, ContextCompat.getColor(context, CoreUiR.color.status_dot_online))
                    binding.tvInternetStatus.text = getString(CoreUiR.string.status_online)
                }
                ConnectivityState.OFFLINE -> {
                    setDotColor(binding.dotInternet, ContextCompat.getColor(context, CoreUiR.color.status_dot_offline))
                    binding.tvInternetStatus.text = getString(CoreUiR.string.status_offline)
                }
            }
        }
    }

    private suspend fun observePrinterStatus() {
        viewModel.printerStatus.collect { status ->
            val context = context ?: return@collect
            when (status) {
                PrinterStatus.CONNECTED -> {
                    setDotColor(binding.dotPrinter, ContextCompat.getColor(context, CoreUiR.color.status_dot_online))
                    binding.tvPrinterStatus.text = getString(CoreUiR.string.status_printer_connected)
                }
                PrinterStatus.RECONNECTING -> {
                    setDotColor(binding.dotPrinter, ContextCompat.getColor(context, CoreUiR.color.status_dot_reconnecting))
                    binding.tvPrinterStatus.text = getString(CoreUiR.string.status_printer_reconnecting)
                }
                PrinterStatus.DISCONNECTED -> {
                    setDotColor(binding.dotPrinter, ContextCompat.getColor(context, CoreUiR.color.status_dot_offline))
                    binding.tvPrinterStatus.text = getString(CoreUiR.string.status_printer_disconnected)
                }
            }
        }
    }

    private suspend fun observePendingCount() {
        viewModel.pendingOrderCount.collect { count ->
            if (count > 0) {
                binding.badgePendingOrders.visibility = View.VISIBLE
                binding.badgePendingOrders.text = if (count > 99) "99+" else count.toString()
                binding.cardPendingOrders.contentDescription =
                    getString(R.string.content_desc_pending_orders_with_count, count)
            } else {
                binding.badgePendingOrders.visibility = View.GONE
                binding.cardPendingOrders.contentDescription =
                    getString(R.string.content_desc_pending_orders)
            }
        }
    }

    private suspend fun observePreparingCount() {
        viewModel.preparingOrderCount.collect { count ->
            if (count > 0) {
                binding.badgeKitchen.visibility = View.VISIBLE
                binding.badgeKitchen.text = if (count > 99) "99+" else count.toString()
                binding.cardKitchen.contentDescription =
                    getString(R.string.content_desc_kitchen_with_count, count)
            } else {
                binding.badgeKitchen.visibility = View.GONE
                binding.cardKitchen.contentDescription =
                    getString(R.string.content_desc_kitchen)
            }
        }
    }

    private suspend fun observeCashierName() {
        viewModel.cashierName.collect { name ->
            binding.tvCashierName.text = getString(R.string.dashboard_cashier_label, name)
        }
    }

    private suspend fun observeDeviceName() {
        viewModel.deviceName.collect { name ->
            binding.tvDeviceName.text = name
        }
    }

    private fun setDotColor(dotView: View, color: Int) {
        val background = dotView.background
        if (background is GradientDrawable) {
            background.setColor(color)
        } else {
            val drawable = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(color)
            }
            dotView.background = drawable
        }
    }

    private fun startDateTimeUpdates() {
        binding.tvDateTime.text = dateTimeFormat.format(Date())
        dateTimeHandler.postDelayed(dateTimeRunnable, 60_000L)
    }

    override fun onDestroyView() {
        dateTimeHandler.removeCallbacks(dateTimeRunnable)
        super.onDestroyView()
        _binding = null
    }
}
