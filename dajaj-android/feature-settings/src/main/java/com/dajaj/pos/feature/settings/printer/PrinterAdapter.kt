package com.dajaj.pos.feature.settings.printer

import android.graphics.drawable.GradientDrawable
import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.dajaj.pos.bluetooth.model.PrinterInfo
import com.dajaj.pos.bluetooth.model.PrinterRole
import com.dajaj.pos.feature.settings.R
import com.dajaj.pos.feature.settings.databinding.ItemPrinterBinding

/**
 * ListAdapter for displaying paired/discovered printers with status indicators
 * and action buttons (Connect/Disconnect, Test Print, role chips).
 */
class PrinterAdapter(
    private val onConnectClick: (PrinterInfo) -> Unit,
    private val onDisconnectClick: (PrinterInfo) -> Unit,
    private val onTestPrintClick: (PrinterInfo) -> Unit,
    private val onSetKotClick: (PrinterInfo) -> Unit,
    private val onSetBillClick: (PrinterInfo) -> Unit
) : ListAdapter<PrinterInfo, PrinterAdapter.PrinterViewHolder>(PrinterDiffCallback()) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): PrinterViewHolder {
        val binding = ItemPrinterBinding.inflate(
            LayoutInflater.from(parent.context), parent, false
        )
        return PrinterViewHolder(binding)
    }

    override fun onBindViewHolder(holder: PrinterViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    inner class PrinterViewHolder(
        private val binding: ItemPrinterBinding
    ) : RecyclerView.ViewHolder(binding.root) {

        fun bind(printer: PrinterInfo) {
            binding.tvPrinterName.text = printer.name
            binding.tvMacAddress.text = printer.macAddress

            // Status indicator
            val statusText: String
            val statusColor: Int

            if (printer.isConnected) {
                statusText = "Connected"
                statusColor = ContextCompat.getColor(binding.root.context, R.color.status_connected)
            } else {
                statusText = "Disconnected"
                statusColor = ContextCompat.getColor(binding.root.context, R.color.status_disconnected)
            }

            binding.tvStatusText.text = statusText
            val dotDrawable = binding.viewStatusDot.background as? GradientDrawable
            dotDrawable?.setColor(statusColor)

            // Connect/Disconnect button
            if (printer.isConnected) {
                binding.btnConnectDisconnect.text = "Disconnect"
                binding.btnConnectDisconnect.contentDescription = "Disconnect from ${printer.name}"
                binding.btnConnectDisconnect.setOnClickListener {
                    onDisconnectClick(printer)
                }
            } else {
                binding.btnConnectDisconnect.text = "Connect"
                binding.btnConnectDisconnect.contentDescription = "Connect to ${printer.name}"
                binding.btnConnectDisconnect.setOnClickListener {
                    onConnectClick(printer)
                }
            }

            // Test Print button (enabled only when connected)
            binding.btnTestPrint.isEnabled = printer.isConnected
            binding.btnTestPrint.setOnClickListener {
                onTestPrintClick(printer)
            }

            // Role chips
            binding.chipKotPrinter.isChecked = printer.role == PrinterRole.KOT
            binding.chipBillPrinter.isChecked = printer.role == PrinterRole.BILL

            binding.chipKotPrinter.setOnClickListener {
                onSetKotClick(printer)
            }
            binding.chipBillPrinter.setOnClickListener {
                onSetBillClick(printer)
            }

            // Accessibility
            binding.root.contentDescription = buildContentDescription(printer)
        }

        private fun buildContentDescription(printer: PrinterInfo): String {
            val status = if (printer.isConnected) "Connected" else "Disconnected"
            val role = when (printer.role) {
                PrinterRole.KOT -> ", assigned as KOT Printer"
                PrinterRole.BILL -> ", assigned as Bill Printer"
                PrinterRole.NONE -> ""
            }
            return "${printer.name}, ${printer.macAddress}, $status$role"
        }
    }

    private class PrinterDiffCallback : DiffUtil.ItemCallback<PrinterInfo>() {
        override fun areItemsTheSame(oldItem: PrinterInfo, newItem: PrinterInfo): Boolean =
            oldItem.macAddress == newItem.macAddress

        override fun areContentsTheSame(oldItem: PrinterInfo, newItem: PrinterInfo): Boolean =
            oldItem == newItem
    }
}
