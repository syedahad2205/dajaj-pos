package com.dajaj.pos.feature.pendingorders

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.dajaj.pos.domain.model.OrderChannel
import com.dajaj.pos.domain.model.PendingOrder
import com.dajaj.pos.feature.pendingorders.databinding.ItemPendingOrderBinding
import java.util.concurrent.TimeUnit

/**
 * RecyclerView adapter for pending order cards.
 *
 * Uses ListAdapter with DiffUtil for efficient list updates.
 * Binds order data including channel icon, elapsed time, customer name,
 * item count, and total. Provides accept/reject click callbacks.
 */
class PendingOrdersAdapter(
    private val onAcceptClick: (PendingOrder) -> Unit,
    private val onRejectClick: (PendingOrder) -> Unit,
    private val onCardClick: (PendingOrder) -> Unit = {}
) : ListAdapter<PendingOrder, PendingOrdersAdapter.OrderViewHolder>(OrderDiffCallback()) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): OrderViewHolder {
        val binding = ItemPendingOrderBinding.inflate(
            LayoutInflater.from(parent.context),
            parent,
            false
        )
        return OrderViewHolder(binding)
    }

    override fun onBindViewHolder(holder: OrderViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    inner class OrderViewHolder(
        private val binding: ItemPendingOrderBinding
    ) : RecyclerView.ViewHolder(binding.root) {

        fun bind(order: PendingOrder) {
            val context = binding.root.context

            // Channel icon
            binding.ivChannelIcon.setImageResource(getChannelIconRes(order.channel))
            binding.ivChannelIcon.contentDescription = context.getString(
                R.string.pending_content_desc_channel_icon
            )

            // Order number
            binding.tvOrderNumber.text = context.getString(
                R.string.pending_order_number,
                order.orderNumber
            )

            // Elapsed time
            binding.tvElapsedTime.text = formatElapsedTime(order.createdAt)

            // Customer name
            binding.tvCustomerName.text = context.getString(
                R.string.pending_customer_name,
                order.customerName.ifEmpty { "Unknown" }
            )

            // Item count + total
            binding.tvItemsAndTotal.text = context.getString(
                R.string.pending_items_and_total,
                order.items.size,
                formatTotal(order.total)
            )

            // Accept button
            binding.btnAccept.contentDescription = context.getString(
                R.string.pending_content_desc_accept_order,
                order.orderNumber
            )
            binding.btnAccept.setOnClickListener { onAcceptClick(order) }

            // Reject button
            binding.btnReject.contentDescription = context.getString(
                R.string.pending_content_desc_reject_order,
                order.orderNumber
            )
            binding.btnReject.setOnClickListener { onRejectClick(order) }

            // Card body click (expand details)
            binding.root.setOnClickListener { onCardClick(order) }
        }
    }

    // --- Helper functions ---

    /**
     * Returns the appropriate drawable resource for the order channel icon.
     */
    private fun getChannelIconRes(channel: OrderChannel): Int {
        return when (channel) {
            OrderChannel.WALK_IN -> android.R.drawable.ic_menu_myplaces
            OrderChannel.WHATSAPP -> android.R.drawable.sym_action_chat
            OrderChannel.WEBSITE -> android.R.drawable.ic_menu_compass
            OrderChannel.QR -> android.R.drawable.ic_menu_camera
            OrderChannel.SWIGGY -> android.R.drawable.ic_menu_send
            OrderChannel.ZOMATO -> android.R.drawable.ic_menu_send
        }
    }

    /**
     * Formats the elapsed time since order creation as a human-readable string.
     * Examples: "just now", "2m ago", "1h ago"
     */
    private fun formatElapsedTime(createdAtMillis: Long): String {
        val elapsedMs = System.currentTimeMillis() - createdAtMillis
        val minutes = TimeUnit.MILLISECONDS.toMinutes(elapsedMs)
        val hours = TimeUnit.MILLISECONDS.toHours(elapsedMs)

        return when {
            minutes < 1 -> "just now"
            hours < 1 -> "${minutes}m ago"
            else -> "${hours}h ago"
        }
    }

    /**
     * Formats the total as a display string (without currency symbol,
     * as it's included in the string resource).
     */
    private fun formatTotal(total: Double): String {
        return if (total == total.toLong().toDouble()) {
            total.toLong().toString()
        } else {
            String.format("%.2f", total)
        }
    }

    /**
     * DiffUtil callback for efficient list updates.
     */
    class OrderDiffCallback : DiffUtil.ItemCallback<PendingOrder>() {
        override fun areItemsTheSame(oldItem: PendingOrder, newItem: PendingOrder): Boolean {
            return oldItem.id == newItem.id
        }

        override fun areContentsTheSame(oldItem: PendingOrder, newItem: PendingOrder): Boolean {
            return oldItem == newItem
        }
    }
}
