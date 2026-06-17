package com.dajaj.pos.data.di

import com.dajaj.pos.data.repository.KitchenRepositoryImpl
import com.dajaj.pos.domain.repository.KitchenRepository
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Hilt module that binds the [KitchenRepository] interface to its implementation.
 *
 * Installed in [SingletonComponent] so that the kitchen repository is a singleton
 * shared across the application lifecycle. The implementation receives its
 * dependencies (OrdersCollection, FirebaseFirestore) from [FirestoreModule].
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class KitchenModule {

    @Binds
    @Singleton
    abstract fun bindKitchenRepository(
        impl: KitchenRepositoryImpl
    ): KitchenRepository
}
