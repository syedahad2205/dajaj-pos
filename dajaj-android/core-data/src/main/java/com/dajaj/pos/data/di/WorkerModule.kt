package com.dajaj.pos.data.di

import android.content.Context
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import androidx.work.WorkManager
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Hilt module providing WorkManager dependencies with Hilt-aware worker injection.
 *
 * Provides [Configuration] with [HiltWorkerFactory] so that WorkManager-based
 * workers (SyncWorker, HeartbeatWorker, PurgeWorker) can receive constructor-injected
 * dependencies via @HiltWorker annotation.
 *
 * NOTE: [WorkManager] instance is already provided by [OrderModule]. This module
 * focuses on the [Configuration] and [HiltWorkerFactory] integration.
 */
@Module
@InstallIn(SingletonComponent::class)
object WorkerModule {

    @Provides
    @Singleton
    fun provideWorkManagerConfiguration(
        workerFactory: HiltWorkerFactory
    ): Configuration {
        return Configuration.Builder()
            .setWorkerFactory(workerFactory)
            .build()
    }
}
