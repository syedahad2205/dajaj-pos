package com.dajaj.pos.data.di

import com.dajaj.pos.data.repository.DeviceRepositoryImpl
import com.dajaj.pos.domain.repository.DeviceRepository
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Hilt module that binds [DeviceRepository] interface to its concrete [DeviceRepositoryImpl].
 *
 * Installed in [SingletonComponent] so that the device repository is a singleton
 * shared across the application lifecycle, maintaining consistent device identity
 * and heartbeat state.
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class DeviceModule {

    @Binds
    @Singleton
    abstract fun bindDeviceRepository(impl: DeviceRepositoryImpl): DeviceRepository
}
