package com.dajaj.pos.data.di

import com.dajaj.pos.data.repository.BillingRepositoryImpl
import com.dajaj.pos.domain.repository.BillingRepository
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Hilt module that binds [BillingRepository] interface to its concrete [BillingRepositoryImpl].
 *
 * Installed in [SingletonComponent] so that the billing repository is a singleton
 * shared across the application lifecycle, managing bill creation, offline persistence,
 * and Firestore synchronization.
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class BillingModule {

    @Binds
    @Singleton
    abstract fun bindBillingRepository(impl: BillingRepositoryImpl): BillingRepository
}
