package com.dajaj.pos.data.di

import android.content.Context
import androidx.room.Room
import com.dajaj.pos.data.local.AppDatabase
import com.dajaj.pos.data.local.dao.CustomerDao
import com.dajaj.pos.data.local.dao.MenuDao
import com.dajaj.pos.data.local.dao.OrderDao
import com.dajaj.pos.data.local.dao.PrintJobDao
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object RoomModule {

    @Provides
    @Singleton
    fun provideAppDatabase(@ApplicationContext context: Context): AppDatabase {
        return Room.databaseBuilder(
            context,
            AppDatabase::class.java,
            "dajaj_pos_db"
        )
            .fallbackToDestructiveMigration()
            .build()
    }

    @Provides
    @Singleton
    fun provideMenuDao(database: AppDatabase): MenuDao {
        return database.menuDao()
    }

    @Provides
    @Singleton
    fun provideOrderDao(database: AppDatabase): OrderDao {
        return database.orderDao()
    }

    @Provides
    @Singleton
    fun providePrintJobDao(database: AppDatabase): PrintJobDao {
        return database.printJobDao()
    }

    @Provides
    @Singleton
    fun provideCustomerDao(database: AppDatabase): CustomerDao {
        return database.customerDao()
    }
}
