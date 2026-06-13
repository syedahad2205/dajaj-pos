package com.dajaj.pos.bluetooth.di

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.Context
import com.dajaj.pos.bluetooth.PrinterManager
import com.dajaj.pos.bluetooth.PrinterManagerImpl
import com.dajaj.pos.bluetooth.connection.AutoReconnectManager
import com.dajaj.pos.bluetooth.connection.PrinterConnectionManager
import com.dajaj.pos.bluetooth.scanner.BluetoothPairingHelper
import com.dajaj.pos.bluetooth.scanner.BluetoothScanner
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class BluetoothModule {

    @Binds
    @Singleton
    abstract fun bindPrinterManager(impl: PrinterManagerImpl): PrinterManager

    companion object {

        @Provides
        @Singleton
        fun provideBluetoothManager(@ApplicationContext context: Context): BluetoothManager {
            return context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        }

        @Provides
        @Singleton
        fun provideBluetoothAdapter(bluetoothManager: BluetoothManager): BluetoothAdapter? {
            return bluetoothManager.adapter
        }

        @Provides
        @Singleton
        fun provideAutoReconnectManager(): AutoReconnectManager {
            return AutoReconnectManager()
        }

        @Provides
        @Singleton
        fun providePrinterConnectionManager(
            bluetoothAdapter: BluetoothAdapter?,
            autoReconnectManager: AutoReconnectManager
        ): PrinterConnectionManager {
            return PrinterConnectionManager(bluetoothAdapter, autoReconnectManager)
        }

        @Provides
        @Singleton
        fun provideBluetoothScanner(
            @ApplicationContext context: Context,
            bluetoothAdapter: BluetoothAdapter?
        ): BluetoothScanner {
            return BluetoothScanner(context, bluetoothAdapter)
        }

        @Provides
        @Singleton
        fun provideBluetoothPairingHelper(
            @ApplicationContext context: Context,
            bluetoothAdapter: BluetoothAdapter?
        ): BluetoothPairingHelper {
            return BluetoothPairingHelper(context, bluetoothAdapter)
        }
    }
}
