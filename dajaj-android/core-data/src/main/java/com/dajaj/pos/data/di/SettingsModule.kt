package com.dajaj.pos.data.di

import com.dajaj.pos.data.repository.SettingsRepositoryImpl
import com.dajaj.pos.domain.repository.SettingsRepository
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Hilt module that binds [SettingsRepository] interface to its concrete [SettingsRepositoryImpl].
 *
 * Installed in [SingletonComponent] so that the settings repository is a singleton
 * shared across the application lifecycle, maintaining a single Firestore listener
 * for settings changes.
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class SettingsModule {

    @Binds
    @Singleton
    abstract fun bindSettingsRepository(impl: SettingsRepositoryImpl): SettingsRepository
}
