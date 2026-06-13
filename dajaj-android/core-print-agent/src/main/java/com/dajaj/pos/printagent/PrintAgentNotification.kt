package com.dajaj.pos.printagent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat

/**
 * Helper for creating and updating the Print Agent foreground service notification.
 *
 * Creates a notification channel (required on Android O+) and builds the
 * persistent notification that displays the current processing state:
 * IDLE, PRINTING, or ERROR.
 */
object PrintAgentNotification {

    const val CHANNEL_ID = "print_agent_channel"
    const val NOTIFICATION_ID = 1001

    private const val CHANNEL_NAME = "Print Agent"
    private const val CHANNEL_DESCRIPTION = "Shows the current status of the print agent service"

    /**
     * Creates the notification channel for the Print Agent service.
     * Must be called before starting the foreground service on Android O+.
     *
     * @param context Application or service context.
     */
    fun createNotificationChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = CHANNEL_DESCRIPTION
                setShowBadge(false)
            }
            val notificationManager =
                context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    /**
     * Builds a foreground notification reflecting the current [PrintAgentState].
     *
     * @param context Application or service context.
     * @param state The current state of the print agent.
     * @return A [Notification] ready to use with [android.app.Service.startForeground].
     */
    fun buildNotification(context: Context, state: PrintAgentState): Notification {
        val (title, text, icon) = when (state) {
            PrintAgentState.IDLE -> Triple(
                "Print Agent",
                "Waiting for print jobs...",
                android.R.drawable.ic_menu_recent_history
            )
            PrintAgentState.PRINTING -> Triple(
                "Print Agent",
                "Printing in progress...",
                android.R.drawable.ic_menu_send
            )
            PrintAgentState.ERROR -> Triple(
                "Print Agent",
                "Print error occurred. Check printer connection.",
                android.R.drawable.ic_dialog_alert
            )
        }

        return NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(icon)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    /**
     * Updates the existing foreground notification with a new state.
     *
     * @param context Application or service context.
     * @param state The new [PrintAgentState] to display.
     */
    fun updateNotification(context: Context, state: PrintAgentState) {
        val notificationManager =
            context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val notification = buildNotification(context, state)
        notificationManager.notify(NOTIFICATION_ID, notification)
    }
}
