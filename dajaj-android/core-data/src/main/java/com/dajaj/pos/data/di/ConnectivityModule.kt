package com.dajaj.pos.data.di

import com.dajaj.pos.common.connectivity.ConnectivityObserver
import com.dajaj.pos.data.connectivity.NetworkConnectivityMonitor
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class ConnectivityModule {

    @Binds
    @Singleton
    abstract fun bindConnectivityObserver(
        impl: NetworkConnectivityMonitor
    ): ConnectivityObserver
}
