package com.dajaj.pos.data.di

import com.dajaj.pos.data.repository.MenuRepositoryImpl
import com.dajaj.pos.domain.repository.MenuRepository
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Hilt module that binds [MenuRepository] interface to its concrete [MenuRepositoryImpl].
 *
 * Installed in [SingletonComponent] so that the menu repository is a singleton
 * shared across the application lifecycle, maintaining a single Firestore listener.
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class MenuModule {

    @Binds
    @Singleton
    abstract fun bindMenuRepository(impl: MenuRepositoryImpl): MenuRepository
}
