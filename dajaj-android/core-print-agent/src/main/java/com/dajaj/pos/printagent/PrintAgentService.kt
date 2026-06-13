package com.dajaj.pos.printagent

import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.util.Log
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import com.dajaj.pos.data.di.DevicesCollection
import com.dajaj.pos.data.di.PrintJobsCollection
import com.dajaj.pos.domain.model.PrintJobStatus
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.QuerySnapshot
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import javax.inject.Inject

/**
 * Foreground Service that continuously listens for pending print jobs in Firestore
 * and dispatches them to the connected Bluetooth printer.
 *
 * Responsibilities:
 * - Runs as a foreground service with a persistent notification (idle/printing/error)
 * - Maintains a real-time Firestore listener for print_jobs where status=PENDING
 * - Checks isPrimaryPrinter flag before processing any jobs
 * - Continues operating when the POS application screen is closed
 * - Starts on BOOT_COMPLETED via [BootReceiver]
 *
 * The actual job claiming and execution logic is handled by downstream tasks (12.5, 12.7).
 * This service provides the lifecycle shell and Firestore listener infrastructure.
 */
@AndroidEntryPoint
class PrintAgentService : LifecycleService() {

    companion object {
        private const val TAG = "PrintAgentService"

        private const val FIELD_STATUS = "status"
        private const val FIELD_RESTAURANT_ID = "restaurantId"
        private const val FIELD_IS_PRIMARY_PRINTER = "isPrimaryPrinter"
        private const val FIELD_CREATED_AT = "createdAt"

        /**
         * Convenience method to start the Print Agent service.
         *
         * @param context Application or Activity context.
         */
        fun start(context: Context) {
            val intent = Intent(context, PrintAgentService::class.java)
            context.startForegroundService(intent)
        }

        /**
         * Convenience method to stop the Print Agent service.
         *
         * @param context Application or Activity context.
         */
        fun stop(context: Context) {
            val intent = Intent(context, PrintAgentService::class.java)
            context.stopService(intent)
        }
    }

    @Inject
    @PrintJobsCollection
    lateinit var printJobsCollection: CollectionReference

    @Inject
    @DevicesCollection
    lateinit var devicesCollection: CollectionReference

    private val _state = MutableStateFlow(PrintAgentState.IDLE)
    val state: StateFlow<PrintAgentState> = _state.asStateFlow()

    private var printJobsListener: ListenerRegistration? = null
    private var processingJob: Job? = null

    /**
     * The restaurant ID this device belongs to. In a production implementation,
     * this would come from the authenticated user's profile or device registration.
     * For now, we use a default value that can be configured.
     */
    private val restaurantId: String
        get() = "dajaj_main"

    /**
     * The device ID for this Android POS. In production, this comes from
     * the device registration in the Device_Registry.
     */
    private val deviceId: String
        get() = android.provider.Settings.Secure.getString(
            contentResolver,
            android.provider.Settings.Secure.ANDROID_ID
        )

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "PrintAgentService created")

        // Create notification channel and start foreground immediately
        PrintAgentNotification.createNotificationChannel(this)
        val notification = PrintAgentNotification.buildNotification(this, PrintAgentState.IDLE)
        startForeground(PrintAgentNotification.NOTIFICATION_ID, notification)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        Log.d(TAG, "PrintAgentService onStartCommand")

        // Start listening for pending print jobs
        startPrintJobsListener()

        // Return START_STICKY so the system restarts the service if killed
        return START_STICKY
    }

    override fun onDestroy() {
        Log.d(TAG, "PrintAgentService destroyed")
        stopPrintJobsListener()
        processingJob?.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent): IBinder? {
        super.onBind(intent)
        return null
    }

    /**
     * Updates the service state and reflects it in the notification.
     *
     * @param newState The new [PrintAgentState].
     */
    fun updateState(newState: PrintAgentState) {
        _state.value = newState
        PrintAgentNotification.updateNotification(this, newState)
    }

    /**
     * Starts the real-time Firestore listener for pending print jobs.
     * Only processes jobs if this device is marked as the primary printer.
     */
    private fun startPrintJobsListener() {
        // Remove existing listener if any
        stopPrintJobsListener()

        // Query: print_jobs where status=PENDING and restaurantId matches
        val query = printJobsCollection
            .whereEqualTo(FIELD_STATUS, PrintJobStatus.PENDING.toFirestoreValue())
            .whereEqualTo(FIELD_RESTAURANT_ID, restaurantId)

        printJobsListener = query.addSnapshotListener { snapshots, error ->
            if (error != null) {
                Log.e(TAG, "Error listening to print jobs: ${error.message}", error)
                updateState(PrintAgentState.ERROR)
                return@addSnapshotListener
            }

            if (snapshots != null && !snapshots.isEmpty) {
                Log.d(TAG, "Detected ${snapshots.size()} pending print jobs")
                onPendingJobsDetected(snapshots)
            }
        }

        Log.d(TAG, "Print jobs listener started for restaurant: $restaurantId")
    }

    /**
     * Stops the Firestore listener for print jobs.
     */
    private fun stopPrintJobsListener() {
        printJobsListener?.remove()
        printJobsListener = null
    }

    /**
     * Called when pending print jobs are detected in Firestore.
     * Checks if this device is the primary printer before processing.
     *
     * @param snapshots The query snapshot containing pending print job documents.
     */
    private fun onPendingJobsDetected(snapshots: QuerySnapshot) {
        processingJob?.cancel()
        processingJob = lifecycleScope.launch {
            // Check if this device is the primary printer
            if (!isPrimaryPrinter()) {
                Log.d(TAG, "This device is not the primary printer. Skipping jobs.")
                return@launch
            }

            // Process each pending job
            // Note: Actual claiming and execution is implemented in tasks 12.5 and 12.7.
            // This service provides the detection and dispatching infrastructure.
            for (document in snapshots.documents) {
                val jobId = document.id
                Log.d(TAG, "Pending print job detected: $jobId")
                // Job claiming and execution will be added in subsequent tasks
            }
        }
    }

    /**
     * Checks the Device_Registry to determine if this device is the primary printer.
     *
     * @return `true` if this device is designated as the primary printer node.
     */
    private suspend fun isPrimaryPrinter(): Boolean {
        return try {
            val result = devicesCollection.document(deviceId).get().await()
            result?.getBoolean(FIELD_IS_PRIMARY_PRINTER) ?: false
        } catch (e: Exception) {
            Log.e(TAG, "Error checking primary printer status: ${e.message}", e)
            // Default to true for single-device setups to avoid blocking prints
            true
        }
    }
}
