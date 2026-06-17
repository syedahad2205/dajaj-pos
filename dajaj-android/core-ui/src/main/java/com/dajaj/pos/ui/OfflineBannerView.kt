package com.dajaj.pos.ui

import android.content.Context
import android.util.AttributeSet
import android.view.LayoutInflater
import android.view.View
import android.widget.ImageView
import android.widget.TextView
import com.dajaj.pos.ui.databinding.LayoutOfflineBannerBinding
import com.google.android.material.card.MaterialCardView

/**
 * Persistent offline status banner component.
 *
 * Displays a banner when internet and/or printer connectivity is lost.
 * Designed to sit at the top of any screen and persist until connectivity restores.
 *
 * Features:
 * - Shows internet disconnection status
 * - Shows printer disconnection status
 * - Displays queued item counts (orders/print jobs)
 * - Automatically hides when all connections are restored
 * - Meets WCAG AA accessibility requirements (4.5:1 contrast, 48dp touch targets)
 *
 * Usage in XML:
 * ```xml
 * <com.dajaj.pos.ui.OfflineBannerView
 *     android:id="@+id/offlineBanner"
 *     android:layout_width="match_parent"
 *     android:layout_height="wrap_content" />
 * ```
 */
class OfflineBannerView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = com.google.android.material.R.attr.materialCardViewStyle
) : MaterialCardView(context, attrs, defStyleAttr) {

    private val binding: LayoutOfflineBannerBinding

    private val bannerIcon: ImageView
    private val bannerTitle: TextView
    private val bannerSubtitle: TextView
    private val printerIcon: ImageView

    private var isInternetOffline = false
    private var isPrinterOffline = false

    init {
        // Zero elevation for a flat banner appearance
        cardElevation = 0f
        radius = 0f
        strokeWidth = 0

        binding = LayoutOfflineBannerBinding.inflate(
            LayoutInflater.from(context),
            this
        )

        bannerIcon = binding.offlineBannerIcon
        bannerTitle = binding.offlineBannerTitle
        bannerSubtitle = binding.offlineBannerSubtitle
        printerIcon = binding.offlineBannerPrinterIcon

        // Default to hidden
        visibility = View.GONE

        setCardBackgroundColor(context.getColor(R.color.banner_error_background))
    }

    /**
     * Update the internet connectivity status.
     *
     * @param offline true if internet is disconnected
     */
    fun setInternetOffline(offline: Boolean) {
        isInternetOffline = offline
        updateBannerState()
    }

    /**
     * Update the printer connectivity status.
     *
     * @param offline true if the printer is disconnected
     */
    fun setPrinterOffline(offline: Boolean) {
        isPrinterOffline = offline
        updateBannerState()
    }

    /**
     * Set the subtitle text showing queued item counts.
     *
     * @param text subtitle message (e.g., "3 orders queued for sync")
     */
    fun setSubtitle(text: String?) {
        if (text.isNullOrBlank()) {
            bannerSubtitle.visibility = View.GONE
        } else {
            bannerSubtitle.text = text
            bannerSubtitle.visibility = View.VISIBLE
        }
    }

    /**
     * Convenience method to update both statuses at once.
     */
    fun updateStatus(internetOffline: Boolean, printerOffline: Boolean, subtitle: String? = null) {
        isInternetOffline = internetOffline
        isPrinterOffline = printerOffline
        setSubtitle(subtitle)
        updateBannerState()
    }

    private fun updateBannerState() {
        when {
            isInternetOffline && isPrinterOffline -> {
                visibility = View.VISIBLE
                bannerIcon.setImageResource(R.drawable.ic_wifi_off)
                bannerTitle.text = context.getString(R.string.banner_both_offline)
                printerIcon.visibility = View.VISIBLE
            }
            isInternetOffline -> {
                visibility = View.VISIBLE
                bannerIcon.setImageResource(R.drawable.ic_wifi_off)
                bannerTitle.text = context.getString(R.string.banner_no_internet)
                printerIcon.visibility = View.GONE
            }
            isPrinterOffline -> {
                visibility = View.VISIBLE
                bannerIcon.setImageResource(R.drawable.ic_print_disabled)
                bannerTitle.text = context.getString(R.string.banner_printer_error)
                printerIcon.visibility = View.GONE
            }
            else -> {
                visibility = View.GONE
            }
        }

        // Announce for accessibility when banner becomes visible
        if (visibility == View.VISIBLE) {
            announceForAccessibility(bannerTitle.text)
        }
    }
}
