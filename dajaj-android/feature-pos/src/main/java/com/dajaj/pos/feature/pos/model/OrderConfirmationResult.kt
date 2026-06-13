package com.dajaj.pos.feature.pos.model

/**
 * Result data returned after a successful order confirmation.
 *
 * @property orderNumber The global sequential order number (e.g., "1045")
 * @property billNumber The formatted bill number (e.g., "DAJAJ-000001")
 * @property orderId The Firestore document ID for the created order
 */
data class OrderConfirmationResult(
    val orderNumber: String,
    val billNumber: String,
    val orderId: String
)
