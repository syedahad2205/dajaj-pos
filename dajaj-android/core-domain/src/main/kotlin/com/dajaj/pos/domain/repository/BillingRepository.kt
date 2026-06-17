package com.dajaj.pos.domain.repository

import com.dajaj.pos.common.Result
import kotlinx.coroutines.flow.Flow

/**
 * Repository interface for billing operations.
 *
 * Handles bill creation, retrieval, and real-time observation.
 * Implementations manage offline bill persistence in Room and
 * synchronization to Firestore when connectivity is available.
 */
interface BillingRepository {

    /**
     * Creates a new bill and persists it locally and (if online) to Firestore.
     * Generates a sequential bill number via atomic counter.
     *
     * @param bill The bill to create
     * @return Result containing the created bill's ID
     */
    suspend fun createBill(bill: NewBill): Result<String>

    /**
     * Retrieves a bill by its ID from local cache or Firestore.
     *
     * @param billId The ID of the bill to retrieve
     * @return Result containing the bill or an error
     */
    suspend fun getBill(billId: String): Result<Bill>

    /**
     * Observes today's bills for the current restaurant as a reactive Flow.
     * Sorted by creation time, newest first.
     */
    fun observeTodayBills(): Flow<List<Bill>>

    /**
     * Returns the count of bills pending sync to Firestore.
     */
    suspend fun getUnsyncedBillCount(): Int

    /**
     * Synchronizes all locally stored bills to Firestore.
     */
    suspend fun syncPendingBills(): Result<Unit>
}

/**
 * Data class for creating a new bill.
 */
data class NewBill(
    val orderNumber: String,
    val restaurantId: String,
    val orderType: String,
    val channel: String,
    val items: List<BillItem>,
    val subtotal: Double,
    val discountAmount: Double,
    val discountType: String?,
    val discountValue: Double?,
    val discountReason: String?,
    val serviceChargePercent: Double,
    val serviceChargeAmount: Double,
    val cgst: Double,
    val sgst: Double,
    val grandTotal: Double,
    val paymentMode: String,
    val cashCollected: Double?,
    val paymentSplits: List<PaymentSplit>?,
    val punchedBy: String?,
    val customerName: String?,
    val customerPhone: String?
)

data class Bill(
    val id: String,
    val billNo: String,
    val orderNumber: String,
    val restaurantId: String,
    val orderType: String,
    val channel: String,
    val items: List<BillItem>,
    val subtotal: Double,
    val discountAmount: Double,
    val discountType: String?,
    val discountValue: Double?,
    val discountReason: String?,
    val serviceChargePercent: Double,
    val serviceChargeAmount: Double,
    val cgst: Double,
    val sgst: Double,
    val grandTotal: Double,
    val paymentMode: String,
    val cashCollected: Double?,
    val paymentSplits: List<PaymentSplit>?,
    val punchedBy: String?,
    val customerName: String?,
    val customerPhone: String?,
    val publicToken: String?,
    val createdAt: Long
)

data class BillItem(
    val id: String,
    val name: String,
    val variantLabel: String?,
    val qty: Int,
    val basePrice: Double,
    val modifiers: List<BillModifier>,
    val itemTotal: Double
)

data class BillModifier(
    val id: String,
    val name: String,
    val price: Double,
    val groupName: String
)

data class PaymentSplit(
    val method: String,
    val amount: Double
)
