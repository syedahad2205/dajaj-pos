package com.dajaj.pos.data.remote

import com.dajaj.pos.common.Constants
import com.dajaj.pos.common.extensions.toOrderDatePrefix
import com.dajaj.pos.data.di.CountersCollection
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Service for atomic sequential number generation using Firestore transactions.
 *
 * Counter documents:
 * - `orders` — Global order counter (starting at 1000)
 * - `bills` — Global bill counter (starting at 0)
 * - `orders_DDMMYY` — Daily order counter for POS labels (created per-day, starting at 0)
 *
 * All counter operations use [FirebaseFirestore.runTransaction] to guarantee atomicity
 * under concurrent access from multiple devices.
 */
@Singleton
class CounterService @Inject constructor(
    private val firestore: FirebaseFirestore,
    @CountersCollection private val countersCollection: CollectionReference
) {

    companion object {
        private const val FIELD_CURRENT = "current"
        private const val FIELD_VALUE = "value"
        private const val COUNTER_ORDERS = "orders"
        private const val COUNTER_BILLS = "bills"
        private const val COUNTER_DAILY_PREFIX = "orders_"
        private const val MAX_RETRIES = 3
        private const val BILL_NUMBER_PREFIX = "DAJAJ-"
        private const val BILL_NUMBER_PAD_LENGTH = 6
    }

    /**
     * Atomically increments the global `orders` counter and returns the next sequential number.
     * The counter starts at [Constants.ORDER_NUMBER_START] (1000), so the first returned value is 1001.
     *
     * @return The next order number (always > 1000)
     * @throws CounterException if the transaction fails after all retry attempts
     */
    suspend fun getNextOrderNumber(): Long {
        return incrementCounterWithRetry(
            documentId = COUNTER_ORDERS,
            field = FIELD_VALUE,
            startValue = Constants.ORDER_NUMBER_START
        )
    }

    /**
     * Atomically increments the global `bills` counter and returns the next formatted bill number.
     * Format: "DAJAJ-XXXXXX" where XXXXXX is zero-padded (e.g., "DAJAJ-000001").
     *
     * @return The next bill number string (e.g., "DAJAJ-000001")
     * @throws CounterException if the transaction fails after all retry attempts
     */
    suspend fun getNextBillNumber(): String {
        val nextValue = incrementCounterWithRetry(
            documentId = COUNTER_BILLS,
            field = FIELD_CURRENT,
            startValue = 0L
        )
        return "$BILL_NUMBER_PREFIX${nextValue.toString().padStart(BILL_NUMBER_PAD_LENGTH, '0')}"
    }

    /**
     * Atomically increments the daily order counter (`orders_DDMMYY`) and returns the next
     * daily sequence number. Creates the counter document if it doesn't exist for that day.
     *
     * @param date The date string in DDMMYY format (e.g., "150124" for 15 Jan 2024)
     * @return The next daily sequence number (starting from 1)
     * @throws CounterException if the transaction fails after all retry attempts
     */
    suspend fun getNextDailyOrderNumber(date: String): Long {
        return incrementCounterWithRetry(
            documentId = "$COUNTER_DAILY_PREFIX$date",
            field = FIELD_CURRENT,
            startValue = 0L
        )
    }

    /**
     * Generates a full order label by combining the DDMMYY date prefix with the daily counter.
     * Format: "DDMMYY####" where #### is zero-padded to 4 digits.
     *
     * Example: timestamp for 15 Jan 2024 + daily counter 5 → "1501240005"
     *
     * @param timestamp The order creation timestamp in epoch milliseconds
     * @return The full order label string (e.g., "1501240005")
     * @throws CounterException if the transaction fails after all retry attempts
     */
    suspend fun generateOrderLabel(timestamp: Long): String {
        val datePrefix = timestamp.toOrderDatePrefix()
        val dailyNumber = getNextDailyOrderNumber(datePrefix)
        return "$datePrefix${dailyNumber.toString().padStart(4, '0')}"
    }

    /**
     * Atomically increments a counter document, creating it if it doesn't exist.
     * Retries up to [MAX_RETRIES] times on transaction failure.
     *
     * @param documentId The counter document ID in the counters collection
     * @param field The field name to increment ("value" or "current")
     * @param startValue The initial value when creating a new counter document
     * @return The incremented counter value
     * @throws CounterException if all retry attempts are exhausted
     */
    private suspend fun incrementCounterWithRetry(
        documentId: String,
        field: String,
        startValue: Long
    ): Long {
        var lastException: Exception? = null

        repeat(MAX_RETRIES) { attempt ->
            try {
                return incrementCounter(documentId, field, startValue)
            } catch (e: Exception) {
                lastException = e
                // Allow the loop to continue for retries
            }
        }

        throw CounterException(
            "Failed to increment counter '$documentId' after $MAX_RETRIES attempts",
            lastException
        )
    }

    /**
     * Performs a single atomic increment transaction on the specified counter document.
     */
    private suspend fun incrementCounter(
        documentId: String,
        field: String,
        startValue: Long
    ): Long {
        val docRef = countersCollection.document(documentId)

        return firestore.runTransaction { transaction ->
            val snapshot = transaction.get(docRef)

            val currentValue = if (snapshot.exists()) {
                snapshot.getLong(field) ?: startValue
            } else {
                startValue
            }

            val nextValue = currentValue + 1

            if (snapshot.exists()) {
                transaction.update(docRef, field, nextValue)
            } else {
                transaction.set(docRef, mapOf(field to nextValue))
            }

            nextValue
        }.await()
    }
}

/**
 * Exception thrown when a counter transaction fails after exhausting all retry attempts.
 */
class CounterException(
    message: String,
    cause: Throwable? = null
) : Exception(message, cause)
