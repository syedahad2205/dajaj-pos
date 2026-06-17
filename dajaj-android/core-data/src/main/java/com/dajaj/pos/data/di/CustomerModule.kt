package com.dajaj.pos.data.di

import com.dajaj.pos.data.repository.CustomerRepositoryImpl
import com.dajaj.pos.domain.repository.CustomerRepository
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Hilt module that binds [CustomerRepository] interface to its concrete [CustomerRepositoryImpl].
 *
 * Installed in [SingletonComponent] so that the customer repository is a singleton
 * shared across the application lifecycle, managing customer lookups, creation,
 * and local caching for auto-fill during order creation.
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class CustomerModule {

    @Binds
    @Singleton
    abstract fun bindCustomerRepository(impl: CustomerRepositoryImpl): CustomerRepository
}
