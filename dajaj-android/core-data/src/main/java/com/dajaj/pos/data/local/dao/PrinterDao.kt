package com.dajaj.pos.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.dajaj.pos.data.local.entity.PrinterEntity
import kotlinx.coroutines.flow.Flow

/**
 * Data Access Object for the printers table.
 * Manages CRUD operations for paired Bluetooth printer configurations.
 */
@Dao
interface PrinterDao {

    /**
     * Returns all paired printers as a reactive Flow.
     * Used to display the printer list in settings.
     */
    @Query("SELECT * FROM printers")
    fun getAllPrinters(): Flow<List<PrinterEntity>>

    /**
     * Returns a single printer by its device ID.
     */
    @Query("SELECT * FROM printers WHERE deviceId = :deviceId")
    suspend fun getById(deviceId: String): PrinterEntity?

    /**
     * Returns the default printer (if any).
     * Used for automatic print job routing.
     */
    @Query("SELECT * FROM printers WHERE isDefault = 1 LIMIT 1")
    suspend fun getDefaultPrinter(): PrinterEntity?

    /**
     * Returns printers by their assigned role (kot or bill).
     */
    @Query("SELECT * FROM printers WHERE role = :role")
    fun getByRole(role: String): Flow<List<PrinterEntity>>

    /**
     * Returns the total number of paired printers.
     * Used to enforce the 5-printer pairing limit.
     */
    @Query("SELECT COUNT(*) FROM printers")
    suspend fun getPairedCount(): Int

    /**
     * Inserts a new printer configuration, replacing on conflict.
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(printer: PrinterEntity)

    /**
     * Updates an existing printer configuration.
     */
    @Update
    suspend fun update(printer: PrinterEntity)

    /**
     * Removes a printer by its device ID (unpair).
     */
    @Query("DELETE FROM printers WHERE deviceId = :deviceId")
    suspend fun delete(deviceId: String)

    /**
     * Clears the default designation from all printers.
     * Called before setting a new default.
     */
    @Query("UPDATE printers SET isDefault = 0 WHERE isDefault = 1")
    suspend fun clearDefaultPrinter()

    /**
     * Sets a specific printer as the default.
     * Should be called after clearDefaultPrinter() to ensure uniqueness.
     */
    @Query("UPDATE printers SET isDefault = 1 WHERE deviceId = :deviceId")
    suspend fun setAsDefault(deviceId: String)

    /**
     * Updates the connection status of a printer.
     */
    @Query("UPDATE printers SET status = :status WHERE deviceId = :deviceId")
    suspend fun updateStatus(deviceId: String, status: String)

    /**
     * Updates the last connected timestamp for a printer.
     */
    @Query("UPDATE printers SET lastConnected = :timestamp, status = 'connected' WHERE deviceId = :deviceId")
    suspend fun updateLastConnected(deviceId: String, timestamp: Long)
}
