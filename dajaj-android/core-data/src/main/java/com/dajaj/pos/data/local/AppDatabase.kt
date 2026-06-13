package com.dajaj.pos.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import com.dajaj.pos.data.local.dao.MenuDao
import com.dajaj.pos.data.local.dao.OrderDao
import com.dajaj.pos.data.local.dao.PrintJobDao
import com.dajaj.pos.data.local.entity.MenuEntity
import com.dajaj.pos.data.local.entity.OrderEntity
import com.dajaj.pos.data.local.entity.PrintJobEntity

/**
 * Room database for local caching of Firestore data and offline operations.
 * Serves as read-through cache for menus and offline queue for orders and print jobs.
 */
@Database(
    entities = [
        MenuEntity::class,
        OrderEntity::class,
        PrintJobEntity::class
    ],
    version = 1,
    exportSchema = true
)
@TypeConverters(Converters::class)
abstract class AppDatabase : RoomDatabase() {
    abstract fun menuDao(): MenuDao
    abstract fun orderDao(): OrderDao
    abstract fun printJobDao(): PrintJobDao
}
