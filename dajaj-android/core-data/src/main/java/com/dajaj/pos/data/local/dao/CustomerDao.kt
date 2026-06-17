package com.dajaj.pos.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Upsert
import com.dajaj.pos.data.local.entity.CustomerEntity
import kotlinx.coroutines.flow.Flow

/**
 * Data Access Object for the customers table.
 * Manages customer record lookups for auto-fill and repeat-customer identification.
 */
@Dao
interface CustomerDao {

    /**
     * Searches for a customer by exact phone number.
     * Used for auto-fill during order creation (expected within 2 seconds).
     */
    @Query("SELECT * FROM customers WHERE phone = :phone")
    suspend fun getByPhone(phone: String): CustomerEntity?

    /**
     * Returns the most recent customers ordered by their last order timestamp.
     * Used for quick-select in the customer attachment flow.
     */
    @Query("SELECT * FROM customers ORDER BY lastOrderAt DESC LIMIT :limit")
    fun getRecentCustomers(limit: Int = 20): Flow<List<CustomerEntity>>

    /**
     * Searches customers by name or phone prefix.
     * Enables partial match for quick lookup.
     */
    @Query("SELECT * FROM customers WHERE name LIKE '%' || :query || '%' OR phone LIKE :query || '%' ORDER BY lastOrderAt DESC LIMIT 10")
    suspend fun search(query: String): List<CustomerEntity>

    /**
     * Inserts or updates a customer record.
     * Used when attaching a customer to an order.
     */
    @Upsert
    suspend fun upsert(customer: CustomerEntity)

    /**
     * Inserts a customer, ignoring if one with the same phone already exists.
     * Used for bulk import or sync scenarios.
     */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertIfNotExists(customer: CustomerEntity)

    /**
     * Updates the lastOrderAt timestamp for an existing customer.
     * Called after order confirmation to keep history fresh.
     */
    @Query("UPDATE customers SET lastOrderAt = :timestamp WHERE phone = :phone")
    suspend fun updateLastOrderAt(phone: String, timestamp: Long)

    /**
     * Returns the total number of stored customers.
     */
    @Query("SELECT COUNT(*) FROM customers")
    suspend fun getCount(): Int
}
