package com.dajaj.pos.feature.settings.printer

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
import com.dajaj.pos.feature.settings.databinding.FragmentPrinterSettingsBinding
import com.google.android.material.snackbar.Snackbar
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch

/**
 * Fragment for managing Bluetooth thermal printers.
 *
 * Displays:
 * - A "Scan for Printers" button to initiate Bluetooth discovery
 * - A scanning progress indicator during active scans
 * - A list of paired/discovered printers with status and action controls
 * - An empty state message when no printers are paired
 *
 * Actions per printer:
 * - Connect / Disconnect
 * - Test Print (sends test page, confirms within 10s)
 * - Set as KOT Printer / Set as Bill Printer (role assignment)
 */
@AndroidEntryPoint
class PrinterSettingsFragment : Fragment() {

    private var _binding: FragmentPrinterSettingsBinding? = null
    private val binding get() = _binding!!

    private val viewModel: PrinterSettingsViewModel by viewModels()

    private var printerAdapter: PrinterAdapter? = null

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentPrinterSettingsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        setupRecyclerView()
        setupScanButton()
        observeViewModel()
    }

    /**
     * Configures the RecyclerView with a [PrinterAdapter] for displaying
     * paired printers and their action controls.
     */
    private fun setupRecyclerView() {
        printerAdapter = PrinterAdapter(
            onConnectClick = { printer -> viewModel.connectPrinter(printer.macAddress) },
            onDisconnectClick = { printer -> viewModel.disconnectPrinter(printer.macAddress) },
            onTestPrintClick = { printer -> viewModel.testPrint(printer.macAddress) },
            onSetKotClick = { printer -> viewModel.setAsKotPrinter(printer.macAddress) },
            onSetBillClick = { printer -> viewModel.setAsBillPrinter(printer.macAddress) }
        )

        binding.rvPrinters.apply {
            layoutManager = LinearLayoutManager(requireContext())
            adapter = printerAdapter
        }
    }

    /**
     * Sets up the scan button to start Bluetooth discovery via the ViewModel.
     */
    private fun setupScanButton() {
        binding.btnScanPrinters.setOnClickListener {
            viewModel.startScan()
        }
    }

    /**
     * Observes ViewModel state flows and updates UI accordingly.
     * Uses repeatOnLifecycle to safely collect flows tied to fragment lifecycle.
     */
    private fun observeViewModel() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                // Observe printer list
                launch {
                    viewModel.printers.collect { printers ->
                        printerAdapter?.submitList(printers)
                        updateEmptyState(printers.isEmpty())
                    }
                }

                // Observe scan state
                launch {
                    viewModel.scanState.collect { state ->
                        updateScanUI(state)
                    }
                }

                // Observe errors
                launch {
                    viewModel.error.collect { errorMessage ->
                        Snackbar.make(binding.root, errorMessage, Snackbar.LENGTH_LONG).show()
                    }
                }

                // Observe success messages
                launch {
                    viewModel.message.collect { message ->
                        Snackbar.make(binding.root, message, Snackbar.LENGTH_SHORT).show()
                    }
                }
            }
        }
    }

    /**
     * Updates UI elements based on the current [ScanState].
     * Shows/hides progress indicator and scanning label,
     * enables/disables the scan button, and shows "no results" state.
     */
    private fun updateScanUI(state: ScanState) {
        when (state) {
            ScanState.IDLE -> {
                binding.progressScanning.visibility = View.GONE
                binding.tvScanningLabel.visibility = View.GONE
                binding.btnScanPrinters.isEnabled = true
            }
            ScanState.SCANNING -> {
                binding.progressScanning.visibility = View.VISIBLE
                binding.tvScanningLabel.visibility = View.VISIBLE
                binding.btnScanPrinters.isEnabled = false
            }
            ScanState.NO_RESULTS -> {
                binding.progressScanning.visibility = View.GONE
                binding.tvScanningLabel.visibility = View.GONE
                binding.btnScanPrinters.isEnabled = true
                Snackbar.make(
                    binding.root,
                    "No printers found. Ensure printer is powered on and in pairing mode.",
                    Snackbar.LENGTH_LONG
                ).show()
            }
            ScanState.RESULTS -> {
                binding.progressScanning.visibility = View.GONE
                binding.tvScanningLabel.visibility = View.GONE
                binding.btnScanPrinters.isEnabled = true
            }
        }
    }

    /**
     * Shows or hides the empty state message based on whether the printer list is empty.
     * The RecyclerView is hidden when empty to display the placeholder message.
     */
    private fun updateEmptyState(isEmpty: Boolean) {
        if (isEmpty) {
            binding.rvPrinters.visibility = View.GONE
            binding.layoutEmptyState.visibility = View.VISIBLE
        } else {
            binding.rvPrinters.visibility = View.VISIBLE
            binding.layoutEmptyState.visibility = View.GONE
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
        printerAdapter = null
    }
}
