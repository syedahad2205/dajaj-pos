package com.dajaj.pos.feature.kitchen

import android.os.Handler
import android.os.Looper
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.dajaj.pos.common.Constants
import com.dajaj.pos.feature.kitchen.databinding.ItemKitchenOrderBinding
import com.dajaj.pos.feature.kitchen.model.KitchenOrder
import java.util.concurrent.TimeUnit

/**
 * RecyclerView ListAdapter for Kitchen order cards.
 *
 * Each card displays:
 * - Order number
 * - Elapsed timer (updates every second via Handler)
 * - Items with quantities
 * - Special notes (if any)
 * - OVERDUE badge when >30 minutes in PREPARING
 * - "Mark Ready" button
 *
 * Uses DiffUtil for efficient list updates from the real-time Firestore listener.
 */
class KitchenAdapter(
    private val onMarkReadyClick: (KitchenOrder) -> Unit
) : ListAdapter<KitchenOrder, KitchenAdapter.KitchenOrderViewHolder>(KitchenOrderDiffCallback()) {

    private val handler = Handler(Looper.getMainLooper())
    private val timerRunnable = object : Runnable {
        override fun run() {
            // Notify visible items to update their elapsed time display
            notifyItemRangeChanged(0, itemCount, PAYLOAD_TIMER_TICK)
            handler.postDelayed(this, TIMER_UPDATE_INTERVAL_MS)
        }
    }

    override fun onAttachedToRecyclerView(recyclerView: RecyclerView) {
        super.onAttachedToRecyclerView(recyclerView)
        handler.postDelayed(timerRunnable, TIMER_UPDATE_INTERVAL_MS)
    }

    override fun onDetachedFromRecyclerView(recyclerView: RecyclerView) {
        super.onDetachedFromRecyclerView(recyclerView)
        handler.removeCallbacks(timerRunnable)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): KitchenOrderViewHolder {
        val binding = ItemKitchenOrderBinding.inflate(
            LayoutInflater.from(parent.context),
            parent,
            false
        )
        return KitchenOrderViewHolder(binding)
    }

    override fun onBindViewHolder(holder: KitchenOrderViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    override fun onBindViewHolder(
        holder: KitchenOrderViewHolder,
        position: Int,
        payloads: MutableList<Any>
    ) {
        if (payloads.contains(PAYLOAD_TIMER_TICK)) {
            // Only update the timer display, not the full bind
            holder.updateTimer(getItem(position))
        } else {
            super.onBindViewHolder(holder, position, payloads)
        }
    }

    inner class KitchenOrderViewHolder(
        private val binding: ItemKitchenOrderBinding
    ) : RecyclerView.ViewHolder(binding.root) {

        fun bind(order: KitchenOrder) {
            val context = binding.root.context

            // Order number
            binding.tvOrderNumber.text = context.getString(
                R.string.kitchen_order_number,
                order.orderNumber
            )

            // Elapsed timer
            updateTimer(order)

            // Overdue indicator
            updateOverdueState(order)

            // Items list
            bindItems(order)

            // Special notes
            if (!order.notes.isNullOrBlank()) {
                binding.tvNotes.text = context.getString(
                    R.string.kitchen_notes,
                    order.notes
                )
                binding.tvNotes.visibility = View.VISIBLE
            } else {
                binding.tvNotes.visibility = View.GONE
            }

            // Mark Ready button
            binding.btnMarkReady.contentDescription = context.getString(
                R.string.kitchen_content_desc_mark_ready,
                order.orderNumber
            )
            binding.btnMarkReady.setOnClickListener {
                onMarkReadyClick(order)
            }
        }

        /**
         * Updates only the elapsed timer display. Called every second via Handler payload.
         */
        fun updateTimer(order: KitchenOrder) {
            val elapsedMs = System.currentTimeMillis() - order.preparingAt
            val totalMinutes = TimeUnit.MILLISECONDS.toMinutes(elapsedMs).toInt()
            val seconds = (TimeUnit.MILLISECONDS.toSeconds(elapsedMs) % 60).toInt()

            binding.tvElapsedTime.text = binding.root.context.getString(
                R.string.kitchen_elapsed_format,
                totalMinutes,
                seconds
            )

            // Update overdue state on each tick (order might cross threshold)
            val isOverdue = elapsedMs >= Constants.OVERDUE_THRESHOLD_MS
            if (isOverdue) {
                binding.tvElapsedTime.setTextColor(
                    ContextCompat.getColor(binding.root.context, R.color.kitchen_overdue_red)
                )
                binding.tvOverdueBadge.visibility = View.VISIBLE
                binding.cardKitchenOrder.strokeColor =
                    ContextCompat.getColor(binding.root.context, R.color.kitchen_overdue_border)
                binding.cardKitchenOrder.strokeWidth = 3
            } else {
                binding.tvElapsedTime.setTextColor(
                    ContextCompat.getColor(binding.root.context, android.R.color.darker_gray)
                )
                binding.tvOverdueBadge.visibility = View.GONE
                binding.cardKitchenOrder.strokeColor =
                    ContextCompat.getColor(binding.root.context, android.R.color.darker_gray)
                binding.cardKitchenOrder.strokeWidth = 1
            }

            binding.tvElapsedTime.contentDescription = binding.root.context.getString(
                R.string.kitchen_content_desc_elapsed_time,
                "${totalMinutes}:${String.format("%02d", seconds)}"
            )
        }

        /**
         * Updates the overdue visual indicator (red border + OVERDUE badge).
         */
        private fun updateOverdueState(order: KitchenOrder) {
            if (order.isOverdue) {
                binding.tvOverdueBadge.visibility = View.VISIBLE
                binding.cardKitchenOrder.strokeColor =
                    ContextCompat.getColor(binding.root.context, R.color.kitchen_overdue_border)
                binding.cardKitchenOrder.strokeWidth = 3

                binding.cardKitchenOrder.contentDescription = binding.root.context.getString(
                    R.string.kitchen_content_desc_overdue,
                    order.orderNumber
                )
            } else {
                binding.tvOverdueBadge.visibility = View.GONE
                binding.cardKitchenOrder.strokeColor =
                    ContextCompat.getColor(binding.root.context, android.R.color.darker_gray)
                binding.cardKitchenOrder.strokeWidth = 1
                binding.cardKitchenOrder.contentDescription = null
            }
        }

        /**
         * Dynamically adds item TextViews to the items LinearLayout.
         */
        private fun bindItems(order: KitchenOrder) {
            val context = binding.root.context
            binding.layoutItems.removeAllViews()

            for (item in order.items) {
                val itemView = TextView(context).apply {
                    text = context.getString(
                        R.string.kitchen_item_line,
                        item.qty,
                        item.name
                    )
                    setTextAppearance(com.google.android.material.R.style.TextAppearance_Material3_BodyLarge)
                    layoutParams = LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT,
                        LinearLayout.LayoutParams.WRAP_CONTENT
                    ).apply {
                        bottomMargin = context.resources.getDimensionPixelSize(
                            R.dimen.kitchen_item_spacing
                        )
                    }
                }
                binding.layoutItems.addView(itemView)
            }
        }
    }

    /**
     * DiffUtil callback for efficient list updates.
     */
    class KitchenOrderDiffCallback : DiffUtil.ItemCallback<KitchenOrder>() {
        override fun areItemsTheSame(oldItem: KitchenOrder, newItem: KitchenOrder): Boolean {
            return oldItem.id == newItem.id
        }

        override fun areContentsTheSame(oldItem: KitchenOrder, newItem: KitchenOrder): Boolean {
            return oldItem == newItem
        }
    }

    companion object {
        /** Payload key for timer-only updates (avoids full rebind). */
        private const val PAYLOAD_TIMER_TICK = "timer_tick"

        /** Timer update interval in milliseconds (1 second). */
        private const val TIMER_UPDATE_INTERVAL_MS = 1000L
    }
}
