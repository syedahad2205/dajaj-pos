package com.dajaj.pos.feature.reports

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Minimal adapter for displaying the bill list in the Reports screen.
 * Each row shows order number, channel, total, and time.
 */
class BillListAdapter : ListAdapter<BillItem, BillListAdapter.BillViewHolder>(BillDiffCallback()) {

    private val currencyFormat = NumberFormat.getCurrencyInstance(Locale("en", "IN"))
    private val timeFormat = SimpleDateFormat("h:mm a", Locale.getDefault())

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): BillViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(android.R.layout.simple_list_item_2, parent, false)
        return BillViewHolder(view)
    }

    override fun onBindViewHolder(holder: BillViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    inner class BillViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val text1: TextView = itemView.findViewById(android.R.id.text1)
        private val text2: TextView = itemView.findViewById(android.R.id.text2)

        fun bind(bill: BillItem) {
            text1.text = "#${bill.orderNumber}  •  ${currencyFormat.format(bill.grandTotal)}"
            val channelLabel = when (bill.channel) {
                "walk_in" -> "Walk-in"
                "whatsapp" -> "WhatsApp"
                "website" -> "Website"
                else -> bill.channel.replaceFirstChar { it.uppercase() }
            }
            text2.text = "$channelLabel  •  ${timeFormat.format(Date(bill.createdAt))}"
        }
    }

    private class BillDiffCallback : DiffUtil.ItemCallback<BillItem>() {
        override fun areItemsTheSame(oldItem: BillItem, newItem: BillItem): Boolean {
            return oldItem.orderNumber == newItem.orderNumber
        }

        override fun areContentsTheSame(oldItem: BillItem, newItem: BillItem): Boolean {
            return oldItem == newItem
        }
    }
}
