package com.dajaj.pos.data.remote

import com.dajaj.pos.data.di.MenusCollection
import com.dajaj.pos.data.local.entity.MenuEntity
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.QuerySnapshot
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Remote data source that establishes a real-time Firestore `onSnapshot` listener
 * on the `menus` collection and emits [MenuEntity] lists whenever the collection changes.
 *
 * This is the single point of contact between the menu sync layer and Firestore.
 * It handles full collection snapshots as well as incremental document changes.
 */
@Singleton
class MenuRemoteDataSource @Inject constructor(
    @MenusCollection private val menusCollection: CollectionReference
) {

    /**
     * Observes menu changes from Firestore in real-time using `addSnapshotListener`.
     *
     * Emits the full list of [MenuEntity] objects on each snapshot update.
     * The flow is backed by [callbackFlow] and will re-establish the listener
     * automatically on reconnect (handled by Firestore SDK internally).
     *
     * @return A [Flow] emitting the complete list of menu entities on every change.
     */
    fun observeMenuChanges(): Flow<List<MenuEntity>> = callbackFlow {
        val listenerRegistration: ListenerRegistration = menusCollection
            .addSnapshotListener { snapshot: QuerySnapshot?, error ->
                if (error != null) {
                    // Emit error through the flow; subscribers can handle retry
                    close(error)
                    return@addSnapshotListener
                }

                if (snapshot != null) {
                    val menuEntities = snapshot.documents.mapNotNull { doc ->
                        mapDocumentToMenuEntity(doc)
                    }
                    trySend(menuEntities)
                }
            }

        awaitClose {
            listenerRegistration.remove()
        }
    }

    /**
     * Maps a Firestore [DocumentSnapshot] to a [MenuEntity].
     * Returns `null` if the document is missing required fields.
     */
    private fun mapDocumentToMenuEntity(doc: DocumentSnapshot): MenuEntity? {
        if (!doc.exists()) return null

        return try {
            MenuEntity(
                id = doc.id,
                name = doc.getString("name") ?: return null,
                parentId = doc.getString("parentId"),
                type = doc.getString("type") ?: "category",
                price = doc.getDouble("price") ?: 0.0,
                selectionType = doc.getString("selectionType") ?: "",
                minSelection = doc.getLong("minSelection")?.toInt() ?: 0,
                maxSelection = doc.getLong("maxSelection")?.toInt() ?: 0,
                description = doc.getString("description"),
                imageUrl = doc.getString("imageUrl"),
                isAvailable = doc.getBoolean("isAvailable") ?: true,
                trackInventory = doc.getBoolean("trackInventory") ?: false,
                inventoryMultiplier = doc.getDouble("inventoryMultiplier"),
                inventoryTrackingMode = doc.getString("inventoryTrackingMode"),
                order = doc.getLong("order")?.toInt() ?: 0,
                createdAt = parseTimestamp(doc, "createdAt"),
                updatedAt = parseTimestamp(doc, "updatedAt")
            )
        } catch (e: Exception) {
            // Skip malformed documents silently
            null
        }
    }

    /**
     * Parses a timestamp field that may be stored as a Firestore Timestamp or a Long.
     */
    private fun parseTimestamp(doc: DocumentSnapshot, field: String): Long {
        return try {
            doc.getTimestamp(field)?.toDate()?.time ?: doc.getLong(field) ?: 0L
        } catch (e: Exception) {
            doc.getLong(field) ?: 0L
        }
    }
}
