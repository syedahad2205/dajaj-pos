package com.dajaj.pos.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import androidx.room.Upsert
import com.dajaj.pos.data.local.entity.OrderEntity
import kotlinx.coroutines.flow.Flow

/**
 * Data Access Object for the orders table.
 * Manages local order caching for offline operation and sync queue.
 */
@Dao
interface OrderDao {

    /**
     * Returns all orders that haven't been synced to Firestore yet,
     * ordered chronologically for FIFO sync processing.
     */
    @Query("SELECT * FROM orders WHERE synced = 0 ORDER BY createdAt ASC")
    fun getUnsyncedOrders(): Flow<List<OrderEntity>>

    /**
     * Returns the count of orders pending sync.
     * Used to display offline queue size to the cashier.
     */
    @Query("SELECT COUNT(*) FROM orders WHERE synced = 0")
    suspend fun getUnsyncedCount(): Int

    /**
     * Observes the count of orders pending sync as a flow.
     */
    @Query("SELECT COUNT(*) FROM orders WHERE synced = 0")
    fun observeUnsyncedCount(): Flow<Int>

    /**
     * Returns all orders for a given status, sorted by creation time.
     * Used for kitchen queue (status='preparing') and pending list.
     */
    @Query("SELECT * FROM orders WHERE status = :status ORDER BY createdAt ASC")
    fun getByStatus(status: String): Flow<List<OrderEntity>>

    /**
     * Returns all orders created within a time range.
     * Used for daily reports and bill history.
     */
    @Query("SELECT * FROM orders WHERE createdAt >= :startTime AND createdAt <= :endTime ORDER BY createdAt DESC")
    fun getByDateRange(startTime: Long, endTime: Long): Flow<List<OrderEntity>>

    /**
     * Returns a single order by its ID.
     */
    @Query("SELECT * FROM orders WHERE id = :orderId")
    suspend fun getById(orderId: String): OrderEntity?

    /**
     * Inserts an order, replacing on conflict.
     * Used when creating new offline orders.
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(order: OrderEntity)

    /**
     * Updates an existing order.
     * Used for status transitions and field updates.
     */
    @Update
    suspend fun update(order: OrderEntity)

    /**
     * Upserts a list of orders.
     * Used when syncing orders from Firestore for local cache.
     */
    @Upsert
    suspend fun upsertAll(orders: List<OrderEntity>)

    /**
     * Marks an order as synced to Firestore.
     */
    @Query("UPDATE orders SET synced = 1 WHERE id = :orderId")
    suspend fun markSynced(orderId: String)

    /**
     * Removes all synced orders from local storage to free space.
     */
    @Query("DELETE FROM orders WHERE synced = 1")
    suspend fun deleteSyncedOrders()

    /**
     * Deletes completed orders older than a timestamp.
     */
    @Query("DELETE FROM orders WHERE status = 'completed' AND createdAt < :timestamp")
    suspend fun deleteCompletedBefore(timestamp: Long): Int
}
