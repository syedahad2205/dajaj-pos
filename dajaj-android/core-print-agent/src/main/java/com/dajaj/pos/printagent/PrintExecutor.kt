package com.dajaj.pos.printagent

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import com.dajaj.pos.bluetooth.PrinterManager
import com.dajaj.pos.bluetooth.escpos.BillTemplateBuilder
import com.dajaj.pos.bluetooth.escpos.KotTemplateBuilder
import com.dajaj.pos.bluetooth.escpos.ReprintTemplateBuilder
import com.dajaj.pos.bluetooth.model.PrinterRole
import com.dajaj.pos.common.Constants
import com.dajaj.pos.common.Result
import com.dajaj.pos.data.di.PrintJobsCollection
import com.dajaj.pos.domain.model.PrintJob
import com.dajaj.pos.domain.model.PrintJobStatus
import com.dajaj.pos.domain.model.PrintJobType
import com.google.firebase.firestore.CollectionReference
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Executes print jobs by sending ESC/POS data to the connected Bluetooth printer.
 *
 * Responsibilities:
 * - Build the ESC/POS byte array from the print job payload using the appropriate template builder
 * - Send data to the Bluetooth printer via [PrinterManager], with a 30-second timeout
 * - Retry failed prints up to [Constants.PRINT_RETRY_MAX] times with exponential backoff
 * - Update Firestore job status to COMPLETED on success, FAILED on exhausted retries
 * - Show a notification on failure allowing manual retry
 *
 * Requirements: 7.7, 7.9, 7.10, 8.5, 8.6, 8.7
 */
@Singleton
class PrintExecutor @Inject constructor(
    @ApplicationContext private val context: Context,
    private val printerManager: PrinterManager,
    private val printJobClaimService: PrintJobClaimService,
    @PrintJobsCollection private val printJobsCollection: CollectionReference
) {

    companion object {
        private const val TAG = "PrintExecutor"

        /** Notification ID base for failed print job alerts. */
        private const val FAILED_NOTIFICATION_ID_BASE = 2000

        /** Action for manual retry from notification. */
        const val ACTION_MANUAL_RETRY = "com.dajaj.pos.printagent.ACTION_MANUAL_RETRY"

        /** Extra key for the print job ID passed in the retry intent. */
        const val EXTRA_JOB_ID = "extra_job_id"
    }

    /**
     * Executes a single print job by building the ESC/POS payload and sending it
     * to the appropriate Bluetooth printer. Times out after [Constants.PRINT_TIMEOUT_MS].
     *
     * @param printJob The print job to execute.
     * @param deviceId The device ID of this print agent (for ownership verification).
     * @return [Result.Success] if the print completed within the timeout,
     *         [Result.Error] if the printer is unavailable, disconnected, or the operation timed out.
     */
    suspend fun executePrintJob(printJob: PrintJob, deviceId: String): Result<Unit> {
        // Determine the target printer role based on printerType
        val role = when (printJob.printerType.lowercase()) {
            "kot" -> PrinterRole.KOT
            "bill" -> PrinterRole.BILL
            else -> PrinterRole.KOT
        }

        // Get connected printer for the specified role
        val printerInfo = printerManager.getConnectedPrinter(role)
            ?: return Result.Error(
                "No connected printer available for role: ${role.name}",
                IOException("Printer not connected for role: ${role.name}")
            )

        // Build ESC/POS byte array from job payload
        val printData = try {
            buildPrintData(printJob)
        } catch (e: Exception) {
            return Result.Error("Failed to build print data: ${e.message}", e)
        }

        // Send to printer with timeout
        val printResult = withTimeoutOrNull(Constants.PRINT_TIMEOUT_MS) {
            printerManager.printData(printerInfo.macAddress, printData)
        }

        return when {
            printResult == null -> {
                Result.Error("Print operation timed out after ${Constants.PRINT_TIMEOUT_MS}ms")
            }
            printResult.isSuccess -> {
                Result.Success(Unit)
            }
            else -> {
                val exception = printResult.exceptionOrNull()
                Result.Error(
                    "Print failed: ${exception?.message ?: "Unknown error"}",
                    exception
                )
            }
        }
    }

    /**
     * Wraps [executePrintJob] with retry logic using exponential backoff.
     *
     * Retries up to [Constants.PRINT_RETRY_MAX] (3) times with delays of 2s, 4s, 8s.
     * On success, updates the Firestore job status to COMPLETED.
     * On all retries exhausted, updates to FAILED with the failure reason and shows a notification.
     *
     * @param printJob The print job to execute with retries.
     * @param deviceId The device ID of this print agent.
     * @return [Result.Success] if printing succeeded on any attempt,
     *         [Result.Error] if all retry attempts failed.
     */
    suspend fun executeWithRetry(printJob: PrintJob, deviceId: String): Result<Unit> {
        var lastError: Result.Error? = null

        repeat(Constants.PRINT_RETRY_MAX) { attempt ->
            Log.d(TAG, "Print attempt ${attempt + 1}/${Constants.PRINT_RETRY_MAX} for job: ${printJob.id}")

            val result = executePrintJob(printJob, deviceId)

            when (result) {
                is Result.Success -> {
                    // Update Firestore status to COMPLETED
                    updateJobCompleted(printJob.id)
                    Log.d(TAG, "Print job ${printJob.id} completed successfully on attempt ${attempt + 1}")
                    return Result.Success(Unit)
                }
                is Result.Error -> {
                    lastError = result
                    Log.w(TAG, "Print attempt ${attempt + 1} failed for job ${printJob.id}: ${result.message}")

                    // Apply exponential backoff if more retries remain
                    if (attempt < Constants.PRINT_RETRY_MAX - 1) {
                        val backoffDelay = Constants.PRINT_RETRY_BASE_DELAY_MS * (1L shl attempt)
                        Log.d(TAG, "Waiting ${backoffDelay}ms before retry...")
                        delay(backoffDelay)
                    }
                }
                is Result.Loading -> { /* Should not occur */ }
            }
        }

        // All retries exhausted — mark as FAILED
        val failureReason = lastError?.message ?: "Print failed after all retry attempts"
        updateJobFailed(printJob.id, failureReason)
        showFailedNotification(printJob, failureReason)

        Log.e(TAG, "Print job ${printJob.id} FAILED after ${Constants.PRINT_RETRY_MAX} attempts: $failureReason")

        return lastError ?: Result.Error("Print failed after ${Constants.PRINT_RETRY_MAX} attempts")
    }

    /**
     * Routes the print job to the appropriate template builder based on [PrintJob.jobType],
     * and builds the ESC/POS byte array from the payload map.
     *
     * @param printJob The print job containing the payload and job type.
     * @return The ESC/POS formatted byte array ready for the printer.
     */
    fun buildPrintData(printJob: PrintJob): ByteArray {
        return when (printJob.jobType) {
            PrintJobType.KOT -> buildKotData(printJob.payload)
            PrintJobType.CUSTOMER_BILL -> buildBillData(printJob.payload)
            PrintJobType.REPRINT -> buildReprintData(printJob)
        }
    }

    /**
     * Builds KOT print data from the payload map using [KotTemplateBuilder].
     */
    private fun buildKotData(payload: Map<String, Any>): ByteArray {
        val orderNumber = payload["orderNumber"] as? String ?: ""
        val orderType = payload["orderType"] as? String ?: ""
        val time = payload["time"] as? String ?: ""
        val specialNotes = payload["specialNotes"] as? String ?: ""

        @Suppress("UNCHECKED_CAST")
        val itemsList = payload["items"] as? List<Map<String, Any>> ?: emptyList()

        val items = itemsList.map { itemMap ->
            KotTemplateBuilder.KotItem(
                name = itemMap["name"] as? String ?: "",
                qty = (itemMap["qty"] as? Number)?.toInt() ?: 1,
                modifiers = (itemMap["modifiers"] as? List<*>)?.filterIsInstance<String>() ?: emptyList(),
                notes = itemMap["notes"] as? String ?: ""
            )
        }

        return KotTemplateBuilder.build(
            orderNumber = orderNumber,
            orderType = orderType,
            time = time,
            items = items,
            specialNotes = specialNotes
        )
    }

    /**
     * Builds customer bill print data from the payload map using [BillTemplateBuilder].
     */
    private fun buildBillData(payload: Map<String, Any>): ByteArray {
        val billNo = payload["billNo"] as? String ?: ""
        val orderType = payload["orderType"] as? String ?: ""
        val paymentMethod = payload["paymentMethod"] as? String ?: "Cash"
        val subtotal = (payload["subtotal"] as? Number)?.toDouble() ?: 0.0
        val cgst = (payload["cgst"] as? Number)?.toDouble() ?: 0.0
        val sgst = (payload["sgst"] as? Number)?.toDouble() ?: 0.0
        val grandTotal = (payload["grandTotal"] as? Number)?.toDouble() ?: 0.0

        @Suppress("UNCHECKED_CAST")
        val itemsList = payload["items"] as? List<Map<String, Any>> ?: emptyList()

        val items = itemsList.map { itemMap ->
            BillTemplateBuilder.BillItem(
                name = itemMap["name"] as? String ?: "",
                qty = (itemMap["qty"] as? Number)?.toInt() ?: 1,
                price = (itemMap["price"] as? Number)?.toDouble() ?: 0.0,
                total = (itemMap["total"] as? Number)?.toDouble() ?: 0.0
            )
        }

        return BillTemplateBuilder.build(
            billNo = billNo,
            orderType = orderType,
            items = items,
            subtotal = subtotal,
            cgst = cgst,
            sgst = sgst,
            grandTotal = grandTotal,
            paymentMethod = paymentMethod
        )
    }

    /**
     * Builds reprint data by first reconstructing the original template,
     * then wrapping it with a REPRINT header via [ReprintTemplateBuilder].
     */
    private fun buildReprintData(printJob: PrintJob): ByteArray {
        val payload = printJob.payload
        val isReprint = payload["isReprint"] as? Boolean ?: true

        // Determine original job type from the payload or printerType
        val originalData = when (printJob.printerType.lowercase()) {
            "kot" -> buildKotData(payload)
            "bill" -> buildBillData(payload)
            else -> buildKotData(payload)
        }

        return if (isReprint) {
            ReprintTemplateBuilder.build(originalData)
        } else {
            originalData
        }
    }

    /**
     * Updates the Firestore print job document status to COMPLETED.
     */
    private suspend fun updateJobCompleted(jobId: String) {
        try {
            printJobsCollection.document(jobId)
                .update(
                    mapOf(
                        "status" to PrintJobStatus.COMPLETED.toFirestoreValue(),
                        "completedAt" to com.google.firebase.Timestamp.now()
                    )
                )
                .await()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to update job $jobId to COMPLETED: ${e.message}", e)
        }
    }

    /**
     * Updates the Firestore print job document status to FAILED with a failure reason.
     */
    private suspend fun updateJobFailed(jobId: String, reason: String) {
        try {
            printJobsCollection.document(jobId)
                .update(
                    mapOf(
                        "status" to PrintJobStatus.FAILED.toFirestoreValue(),
                        "failureReason" to reason,
                        "completedAt" to com.google.firebase.Timestamp.now()
                    )
                )
                .await()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to update job $jobId to FAILED: ${e.message}", e)
        }
    }

    /**
     * Shows a notification indicating a print job has failed, with an action to retry manually.
     * Tapping the retry action resets the job to PENDING status.
     *
     * @param printJob The failed print job.
     * @param reason The failure reason.
     */
    private fun showFailedNotification(printJob: PrintJob, reason: String) {
        val notificationManager =
            context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        // Build retry intent
        val retryIntent = Intent(ACTION_MANUAL_RETRY).apply {
            putExtra(EXTRA_JOB_ID, printJob.id)
            setPackage(context.packageName)
        }
        val retryPendingIntent = PendingIntent.getBroadcast(
            context,
            printJob.id.hashCode(),
            retryIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val jobTypeLabel = when (printJob.jobType) {
            PrintJobType.KOT -> "KOT"
            PrintJobType.CUSTOMER_BILL -> "Bill"
            PrintJobType.REPRINT -> "Reprint"
        }

        val notification = NotificationCompat.Builder(context, PrintAgentNotification.CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("Print Failed: $jobTypeLabel")
            .setContentText("Order #${printJob.orderNumber} — $reason")
            .setStyle(
                NotificationCompat.BigTextStyle()
                    .bigText("$jobTypeLabel print failed for Order #${printJob.orderNumber}.\n$reason\nTap Retry to re-queue the job.")
            )
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .addAction(
                android.R.drawable.ic_menu_rotate,
                "Retry",
                retryPendingIntent
            )
            .build()

        val notificationId = FAILED_NOTIFICATION_ID_BASE + printJob.id.hashCode()
        notificationManager.notify(notificationId, notification)
    }

    /**
     * Resets a FAILED print job back to PENDING status for manual retry.
     * Called when the cashier taps "Retry" on the failure notification.
     *
     * @param jobId The Firestore document ID of the print job to retry.
     */
    suspend fun manualRetry(jobId: String) {
        try {
            printJobsCollection.document(jobId)
                .update(
                    mapOf(
                        "status" to PrintJobStatus.PENDING.toFirestoreValue(),
                        "claimedBy" to null,
                        "claimedAt" to null,
                        "failureReason" to null,
                        "retryCount" to 0
                    )
                )
                .await()
            Log.d(TAG, "Job $jobId reset to PENDING for manual retry")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to reset job $jobId for retry: ${e.message}", e)
        }
    }
}
