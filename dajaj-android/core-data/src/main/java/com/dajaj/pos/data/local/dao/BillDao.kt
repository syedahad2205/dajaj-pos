package com.dajaj.pos.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Upsert
import com.dajaj.pos.data.local.entity.BillEntity
import kotlinx.coroutines.flow.Flow

/**
 * Data Access Object for the bills table.
 * Manages bill records for offline persistence and sync queue.
 */
@Dao
interface BillDao {

    /**
     * Inserts a bill, replacing on conflict.
     * Used when creating new bills (offline or synced).
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(bill: BillEntity)

    /**
     * Upserts a list of bills.
     * Used when syncing bills from Firestore.
     */
    @Upsert
    suspend fun upsertAll(bills: List<BillEntity>)

    /**
     * Returns a bill by its ID.
     */
    @Query("SELECT * FROM bills WHERE id = :billId")
    suspend fun getById(billId: String): BillEntity?

    /**
     * Returns bills for a given restaurant within a date range, sorted newest first.
     * Used for daily bill history and reports.
     */
    @Query("SELECT * FROM bills WHERE restaurantId = :restaurantId AND createdAt >= :startTime AND createdAt <= :endTime ORDER BY createdAt DESC")
    fun getByRestaurantAndDateRange(
        restaurantId: String,
        startTime: Long,
        endTime: Long
    ): Flow<List<BillEntity>>

    /**
     * Returns today's bills for a given restaurant as a reactive Flow.
     * Used for real-time bill list display.
     */
    @Query("SELECT * FROM bills WHERE restaurantId = :restaurantId AND createdAt >= :todayStart ORDER BY createdAt DESC")
    fun getTodayBills(restaurantId: String, todayStart: Long): Flow<List<BillEntity>>

    /**
     * Returns all bills that have not been synced to Firestore.
     * Used by the sync worker to push offline bills.
     */
    @Query("SELECT * FROM bills WHERE synced = 0 ORDER BY createdAt ASC")
    fun getUnsyncedBills(): Flow<List<BillEntity>>

    /**
     * Returns the count of bills pending sync.
     */
    @Query("SELECT COUNT(*) FROM bills WHERE synced = 0")
    suspend fun getUnsyncedCount(): Int

    /**
     * Marks a bill as synced to Firestore.
     */
    @Query("UPDATE bills SET synced = 1 WHERE id = :billId")
    suspend fun markSynced(billId: String)

    /**
     * Returns a bill by its order number.
     * Used for bill lookup from order details.
     */
    @Query("SELECT * FROM bills WHERE orderNumber = :orderNumber LIMIT 1")
    suspend fun getByOrderNumber(orderNumber: String): BillEntity?

    /**
     * Deletes all synced bills to free local storage.
     */
    @Query("DELETE FROM bills WHERE synced = 1")
    suspend fun deleteSyncedBills()
}
