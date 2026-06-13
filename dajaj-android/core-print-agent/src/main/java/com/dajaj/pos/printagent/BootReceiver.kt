package com.dajaj.pos.printagent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * BroadcastReceiver that starts the [PrintAgentService] on device boot.
 *
 * Listens for [Intent.ACTION_BOOT_COMPLETED] to ensure the print agent
 * resumes operation automatically after a device restart, so that print
 * jobs are never missed even if the POS app hasn't been manually opened.
 *
 * Declared in AndroidManifest.xml with RECEIVE_BOOT_COMPLETED permission.
 */
class BootReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "BootReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            Log.d(TAG, "BOOT_COMPLETED received. Starting PrintAgentService.")
            PrintAgentService.start(context)
        }
    }
}
