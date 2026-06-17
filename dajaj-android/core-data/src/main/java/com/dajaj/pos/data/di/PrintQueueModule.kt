package com.dajaj.pos.data.di

import com.dajaj.pos.data.repository.PrintJobRepositoryImpl
import com.dajaj.pos.data.repository.PrintQueueRepositoryImpl
import com.dajaj.pos.domain.repository.PrintJobRepository
import com.dajaj.pos.domain.repository.PrintQueueRepository
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Hilt module that binds print queue repository interfaces to their concrete implementations.
 *
 * Installed in [SingletonComponent] so that the print queue repositories are singletons
 * shared across the application lifecycle, managing print job creation, atomic claiming,
 * offline queueing in Room, and Firestore synchronization.
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class PrintQueueModule {

    @Binds
    @Singleton
    abstract fun bindPrintJobRepository(impl: PrintJobRepositoryImpl): PrintJobRepository

    @Binds
    @Singleton
    abstract fun bindPrintQueueRepository(impl: PrintQueueRepositoryImpl): PrintQueueRepository
}
