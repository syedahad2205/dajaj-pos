package com.dajaj.pos.feature.kitchen

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dajaj.pos.common.Constants
import com.dajaj.pos.data.di.OrdersCollection
import com.dajaj.pos.feature.kitchen.model.KitchenOrder
import com.dajaj.pos.feature.kitchen.model.KitchenOrderItem
import com.dajaj.pos.feature.kitchen.model.KitchenUiState
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.QuerySnapshot
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import javax.inject.Inject

/**
 * ViewModel for the Kitchen screen.
 *
 * Observes orders with status=PREPARING from Firestore in real-time,
 * sorted by `preparingAt` ASC (oldest first / FIFO). Exposes preparing count
 * and handles the "Mark Ready" action.
 *
 * Orders that have been in PREPARING for longer than 30 minutes are flagged
 * as overdue per Requirement 11.6.
 */
@HiltViewModel
class KitchenViewModel @Inject constructor(
    @OrdersCollection private val ordersCollection: CollectionReference
) : ViewModel() {

    private val _uiState = MutableStateFlow(KitchenUiState())
    val uiState: StateFlow<KitchenUiState> = _uiState.asStateFlow()

    /** One-shot UI events (snackbar messages, audio alerts). */
    private val _events = MutableSharedFlow<KitchenEvent>()
    val events: SharedFlow<KitchenEvent> = _events.asSharedFlow()

    private var listenerRegistration: ListenerRegistration? = null

    private val restaurantId = "dajaj_main"

    init {
        observePreparingOrders()
    }

    /**
     * Starts a real-time Firestore listener for orders with status=preparing,
     * sorted by preparingAt ascending (FIFO - oldest first).
     */
    private fun observePreparingOrders() {
        val query = ordersCollection
            .whereEqualTo("restaurantId", restaurantId)
            .whereEqualTo("status", "preparing")
            .orderBy("preparingAt", Query.Direction.ASCENDING)

        listenerRegistration = query.addSnapshotListener { snapshot: QuerySnapshot?, error ->
            if (error != null) {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        error = error.message ?: "Failed to load kitchen orders"
                    )
                }
                return@addSnapshotListener
            }

            if (snapshot != null) {
                val now = System.currentTimeMillis()
                val kitchenOrders = snapshot.documents.mapNotNull { doc ->
                    mapDocumentToKitchenOrder(doc, now)
                }

                _uiState.update {
                    it.copy(
                        orders = kitchenOrders,
                        preparingCount = kitchenOrders.size,
                        isLoading = false,
                        error = null
                    )
                }
            }
        }
    }

    /**
     * Marks an order as READY in Firestore.
     * Updates the order status to "ready" and sets the readyAt timestamp.
     * Emits a [KitchenEvent.OrderMarkedReady] event to trigger the audio alert.
     */
    fun markReady(orderId: String, orderNumber: String) {
        viewModelScope.launch {
            try {
                ordersCollection.document(orderId)
                    .update(
                        mapOf(
                            "status" to "ready",
                            "readyAt" to com.google.firebase.Timestamp.now(),
                            "updatedAt" to com.google.firebase.Timestamp.now()
                        )
                    )
                    .await()

                _events.emit(KitchenEvent.OrderMarkedReady(orderNumber))
            } catch (e: Exception) {
                _events.emit(
                    KitchenEvent.ShowError(
                        "Failed to mark order ready: ${e.message ?: "Unknown error"}"
                    )
                )
            }
        }
    }

    /**
     * Maps a Firestore [DocumentSnapshot] to a [KitchenOrder] UI model.
     * Returns null if the document is missing required fields.
     */
    @Suppress("UNCHECKED_CAST")
    private fun mapDocumentToKitchenOrder(doc: DocumentSnapshot, now: Long): KitchenOrder? {
        if (!doc.exists()) return null

        return try {
            val preparingAt = parseTimestamp(doc, "preparingAt")
            val elapsed = now - preparingAt
            val isOverdue = elapsed >= Constants.OVERDUE_THRESHOLD_MS

            val items = parseItems(doc)

            // Extract notes from items or top-level field
            val notes = doc.getString("notes")
                ?: extractNotesFromItems(doc)

            KitchenOrder(
                id = doc.id,
                orderNumber = doc.getString("orderNumber") ?: return null,
                items = items,
                notes = notes,
                preparingAt = preparingAt,
                isOverdue = isOverdue
            )
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Parses the items array from the order document.
     */
    @Suppress("UNCHECKED_CAST")
    private fun parseItems(doc: DocumentSnapshot): List<KitchenOrderItem> {
        val rawItems = doc.get("items") as? List<Map<String, Any?>> ?: return emptyList()

        return rawItems.mapNotNull { itemMap ->
            try {
                val name = itemMap["name"] as? String ?: return@mapNotNull null
                val variantLabel = itemMap["variantLabel"] as? String
                val displayName = if (!variantLabel.isNullOrBlank()) {
                    "$name $variantLabel"
                } else {
                    name
                }
                val qty = (itemMap["qty"] as? Number)?.toInt() ?: 1

                KitchenOrderItem(
                    name = displayName,
                    qty = qty
                )
            } catch (e: Exception) {
                null
            }
        }
    }

    /**
     * Attempts to extract special notes from the items array (some orders store
     * notes at item level as "specialNotes" or "notes" within each item map).
     * Falls back to null if no notes are found.
     */
    @Suppress("UNCHECKED_CAST")
    private fun extractNotesFromItems(doc: DocumentSnapshot): String? {
        val rawItems = doc.get("items") as? List<Map<String, Any?>> ?: return null
        val notes = rawItems.mapNotNull { itemMap ->
            (itemMap["specialNotes"] as? String)?.takeIf { it.isNotBlank() }
                ?: (itemMap["notes"] as? String)?.takeIf { it.isNotBlank() }
        }
        return if (notes.isNotEmpty()) notes.joinToString("; ") else null
    }

    /**
     * Parses a timestamp field that may be a Firestore Timestamp or a Long.
     */
    private fun parseTimestamp(doc: DocumentSnapshot, field: String): Long {
        return try {
            doc.getTimestamp(field)?.toDate()?.time ?: doc.getLong(field) ?: 0L
        } catch (e: Exception) {
            doc.getLong(field) ?: 0L
        }
    }

    override fun onCleared() {
        super.onCleared()
        listenerRegistration?.remove()
    }
}

/**
 * One-shot UI events emitted by the KitchenViewModel.
 */
sealed class KitchenEvent {
    /** Triggered when an order is successfully marked ready. Plays audio alert. */
    data class OrderMarkedReady(val orderNumber: String) : KitchenEvent()

    /** Error message to show in a snackbar. */
    data class ShowError(val message: String) : KitchenEvent()
}
