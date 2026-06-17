package com.dajaj.pos.domain.repository

import com.dajaj.pos.common.Result
import kotlinx.coroutines.flow.Flow

/**
 * Repository interface for customer management operations.
 *
 * Provides customer lookup by phone, search, and create/update operations.
 * Used for optional customer attachment to orders and repeat-customer identification.
 */
interface CustomerRepository {

    /**
     * Searches for a customer by their exact phone number.
     *
     * @param phone 10-digit Indian mobile number (starts with 6-9)
     * @return Result containing the customer or null if not found
     */
    suspend fun searchByPhone(phone: String): Result<CustomerInfo?>

    /**
     * Creates a new customer or updates an existing one.
     * Uses phone number as the unique key.
     *
     * @param customer The customer info to create or update
     * @return Result indicating success or failure
     */
    suspend fun createOrUpdate(customer: CustomerInfo): Result<Unit>

    /**
     * Searches customers by name or phone prefix.
     *
     * @param query Search query (partial name or phone prefix)
     * @return Result containing matching customers (max 10)
     */
    suspend fun search(query: String): Result<List<CustomerInfo>>

    /**
     * Observes recent customers as a reactive Flow.
     * Sorted by last order timestamp, newest first.
     *
     * @param limit Maximum number of customers to return
     */
    fun observeRecentCustomers(limit: Int = 20): Flow<List<CustomerInfo>>
}

/**
 * Data class representing customer information.
 */
data class CustomerInfo(
    val name: String,   // 1-100 chars
    val phone: String,  // 10-digit Indian mobile, starts with 6-9
    val lastOrderAt: Long? = null,
    val createdAt: Long = System.currentTimeMillis()
)
