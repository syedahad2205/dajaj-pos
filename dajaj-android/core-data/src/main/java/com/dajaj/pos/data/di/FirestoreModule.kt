package com.dajaj.pos.data.di

import com.dajaj.pos.common.Constants
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ktx.firestore
import com.google.firebase.ktx.Firebase
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Qualifier
import javax.inject.Singleton

@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class MenusCollection

@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class OrdersCollection

@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class PendingOrdersCollection

@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class PrintJobsCollection

@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class DevicesCollection

@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class UsersCollection

@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class BillsCollection

@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class CountersCollection

@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class CustomersCollection

@Module
@InstallIn(SingletonComponent::class)
object FirestoreModule {

    @Provides
    @Singleton
    fun provideFirebaseFirestore(): FirebaseFirestore {
        return Firebase.firestore
    }

    @Provides
    @Singleton
    @MenusCollection
    fun provideMenusCollection(firestore: FirebaseFirestore): CollectionReference {
        return firestore.collection(Constants.COLLECTION_MENUS)
    }

    @Provides
    @Singleton
    @OrdersCollection
    fun provideOrdersCollection(firestore: FirebaseFirestore): CollectionReference {
        return firestore.collection(Constants.COLLECTION_ORDERS)
    }

    @Provides
    @Singleton
    @PendingOrdersCollection
    fun providePendingOrdersCollection(firestore: FirebaseFirestore): CollectionReference {
        return firestore.collection(Constants.COLLECTION_PENDING_ORDERS)
    }

    @Provides
    @Singleton
    @PrintJobsCollection
    fun providePrintJobsCollection(firestore: FirebaseFirestore): CollectionReference {
        return firestore.collection(Constants.COLLECTION_PRINT_JOBS)
    }

    @Provides
    @Singleton
    @DevicesCollection
    fun provideDevicesCollection(firestore: FirebaseFirestore): CollectionReference {
        return firestore.collection(Constants.COLLECTION_DEVICES)
    }

    @Provides
    @Singleton
    @UsersCollection
    fun provideUsersCollection(firestore: FirebaseFirestore): CollectionReference {
        return firestore.collection(Constants.COLLECTION_USERS)
    }

    @Provides
    @Singleton
    @BillsCollection
    fun provideBillsCollection(firestore: FirebaseFirestore): CollectionReference {
        return firestore.collection(Constants.COLLECTION_BILLS)
    }

    @Provides
    @Singleton
    @CountersCollection
    fun provideCountersCollection(firestore: FirebaseFirestore): CollectionReference {
        return firestore.collection(Constants.COLLECTION_COUNTERS)
    }

    @Provides
    @Singleton
    @CustomersCollection
    fun provideCustomersCollection(firestore: FirebaseFirestore): CollectionReference {
        return firestore.collection(Constants.COLLECTION_CUSTOMERS)
    }
}
