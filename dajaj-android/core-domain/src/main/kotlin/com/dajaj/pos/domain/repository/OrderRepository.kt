package com.dajaj.pos.domain.repository

import com.dajaj.pos.common.Result

/**
 * Repository interface for order persistence operations.
 *
 * Handles writing orders, bills, and print jobs to Firestore.
 * Implementations handle offline fallback to Room Database.
 */
interface OrderRepository {

    /**
     * Creates an order document in Firestore `orders` collection.
     *
     * @param orderData Map of order fields matching the Firestore schema
     * @return Result containing the created order ID on success
     */
    suspend fun createOrder(orderData: Map<String, Any?>): Result<String>

    /**
     * Creates a bill document in Firestore `bills` collection.
     *
     * @param billData Map of bill fields matching the Firestore schema
     * @return Result containing the created bill ID on success
     */
    suspend fun createBill(billData: Map<String, Any?>): Result<String>

    /**
     * Creates a print job document in Firestore `print_jobs` collection.
     *
     * @param printJobData Map of print job fields matching the Firestore schema
     * @return Result containing the created print job ID on success
     */
    suspend fun createPrintJob(printJobData: Map<String, Any?>): Result<String>

    /**
     * Saves an order locally to Room Database for offline processing.
     * Used when internet connectivity is unavailable.
     *
     * @param orderData Map of order fields
     * @param billData Map of bill fields
     * @param printJobData Map of print job fields
     * @return Result indicating success or failure of local save
     */
    suspend fun saveOrderLocally(
        orderData: Map<String, Any?>,
        billData: Map<String, Any?>,
        printJobData: Map<String, Any?>
    ): Result<Unit>
}
