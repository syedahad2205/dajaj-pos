package com.dajaj.pos.data.di

import android.content.Context
import androidx.work.WorkManager
import com.dajaj.pos.data.repository.OrderRepositoryImpl
import com.dajaj.pos.domain.repository.OrderRepository
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Hilt module that provides order-related dependencies:
 * - Binds [OrderRepository] interface to [OrderRepositoryImpl]
 * - Provides [WorkManager] instance for offline sync operations
 *
 * Installed in [SingletonComponent] so that the order repository and WorkManager
 * are singletons shared across the application lifecycle.
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class OrderModule {

    @Binds
    @Singleton
    abstract fun bindOrderRepository(
        impl: OrderRepositoryImpl
    ): OrderRepository

    companion object {

        @Provides
        @Singleton
        fun provideWorkManager(@ApplicationContext context: Context): WorkManager {
            return WorkManager.getInstance(context)
        }
    }
}
