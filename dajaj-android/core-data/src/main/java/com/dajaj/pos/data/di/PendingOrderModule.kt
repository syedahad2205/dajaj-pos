package com.dajaj.pos.data.di

import com.dajaj.pos.data.repository.PendingOrderRepositoryImpl
import com.dajaj.pos.domain.repository.PendingOrderRepository
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Hilt module that binds [PendingOrderRepository] interface to its concrete
 * [PendingOrderRepositoryImpl].
 *
 * Installed in [SingletonComponent] so that the pending order repository is a singleton
 * shared across the application lifecycle, maintaining a single Firestore listener
 * for real-time pending order updates.
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class PendingOrderModule {

    @Binds
    @Singleton
    abstract fun bindPendingOrderRepository(
        impl: PendingOrderRepositoryImpl
    ): PendingOrderRepository
}
