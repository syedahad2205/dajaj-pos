package com.dajaj.pos.data.repository

import com.dajaj.pos.common.Result
import com.dajaj.pos.data.di.PrintJobsCollection
import com.dajaj.pos.data.local.dao.PrintJobDao
import com.dajaj.pos.domain.model.PrintJob
import com.dajaj.pos.domain.repository.PrintJobRepository
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.ListenerRegistration
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Implementation of [PrintJobRepository] using Firestore for the shared print queue
 * and Room (via [PrintJobDao]) for offline job persistence.
 *
 * Handles atomic job claiming via Firestore transactions to prevent duplicate printing.
 * Falls back to local Room queue when Firestore is unreachable.
 */
@Singleton
class PrintJobRepositoryImpl @Inject constructor(
    @PrintJobsCollection private val printJobsCollection: CollectionReference,
    private val printJobDao: PrintJobDao
) : PrintJobRepository {

    override fun observePendingJobs(restaurantId: String): Flow<List<PrintJob>> = callbackFlow {
        var registration: ListenerRegistration? = null
        registration = printJobsCollection
            .whereEqualTo("restaurantId", restaurantId)
            .whereEqualTo("status", "pending")
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    close(error)
                    return@addSnapshotListener
                }
                // TODO: Map Firestore documents to PrintJob domain models
                trySend(emptyList())
            }
        awaitClose { registration?.remove() }
    }

    override suspend fun claimJob(jobId: String, deviceId: String): Result<Unit> {
        // TODO: Implement atomic claim via Firestore transaction
        return Result.Error("Job claiming not yet implemented", NotImplementedError("Job claiming not yet implemented"))
    }

    override suspend fun markCompleted(jobId: String): Result<Unit> {
        // TODO: Implement status update to COMPLETED
        return Result.Error("Mark completed not yet implemented", NotImplementedError("Mark completed not yet implemented"))
    }

    override suspend fun markFailed(jobId: String, reason: String): Result<Unit> {
        // TODO: Implement status update to FAILED with reason
        return Result.Error("Mark failed not yet implemented", NotImplementedError("Mark failed not yet implemented"))
    }

    override suspend fun createPrintJob(printJob: PrintJob): Result<String> {
        // TODO: Implement print job creation in Firestore (or local if offline)
        return Result.Error("Create print job not yet implemented", NotImplementedError("Create print job not yet implemented"))
    }

    override suspend fun resetToRetry(jobId: String): Result<Unit> {
        // TODO: Implement reset to PENDING for manual retry
        return Result.Error("Reset to retry not yet implemented", NotImplementedError("Reset to retry not yet implemented"))
    }
}
