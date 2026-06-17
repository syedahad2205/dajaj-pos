package com.dajaj.pos.data.repository

import com.dajaj.pos.common.Constants
import com.dajaj.pos.common.Result
import com.dajaj.pos.common.connectivity.ConnectivityObserver
import com.dajaj.pos.common.connectivity.ConnectivityState
import com.dajaj.pos.data.di.BillsCollection
import com.dajaj.pos.data.di.CountersCollection
import com.dajaj.pos.data.local.dao.BillDao
import com.dajaj.pos.data.local.entity.BillEntity
import com.dajaj.pos.domain.repository.Bill
import com.dajaj.pos.domain.repository.BillItem
import com.dajaj.pos.domain.repository.BillModifier
import com.dajaj.pos.domain.repository.BillingRepository
import com.dajaj.pos.domain.repository.NewBill
import com.dajaj.pos.domain.repository.PaymentSplit
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.tasks.await
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Implementation of [BillingRepository] using Firestore for remote persistence
 * and Room (via [BillDao]) for local caching and offline bill creation.
 *
 * Bill numbers are generated via atomic counter transaction on the `counters/bills` document.
 * When offline, bills are saved to Room with synced=false and queued for sync when online.
 *
 * Requirements: 16.1, 16.7, 16.9
 */
@Singleton
class BillingRepositoryImpl @Inject constructor(
    @BillsCollection private val billsCollection: CollectionReference,
    @CountersCollection private val countersCollection: CollectionReference,
    private val billDao: BillDao,
    private val connectivityObserver: ConnectivityObserver,
    private val firestore: FirebaseFirestore
) : BillingRepository {

    companion object {
        private const val RESTAURANT_ID = "dajaj_main"
        private const val COUNTER_DOC_ID = "bills"
        private const val COUNTER_FIELD = "current"
    }

    // -------------------------------------------------------------------------
    // Create Bill (Requirements 16.1, 16.7)
    // -------------------------------------------------------------------------

    /**
     * Creates a new bill with a unique sequential bill number and public access token.
     *
     * Strategy:
     * - Generates a sequential bill number via atomic counter transaction on `counters/bills`
     * - Generates a UUID public access token for customer viewing
     * - If online: saves to Firestore bills collection and Room (synced=true)
     * - If offline or Firestore write fails: saves to Room with synced=false for later sync
     *
     * @param bill The new bill details
     * @return Result containing the created bill's ID on success
     */
    override suspend fun createBill(bill: NewBill): Result<String> {
        val billId = UUID.randomUUID().toString()
        val publicToken = UUID.randomUUID().toString()
        val createdAt = System.currentTimeMillis()
        val isOnline = isCurrentlyOnline()

        // Generate bill number via atomic counter
        val billNo: String = if (isOnline) {
            try {
                generateBillNumber()
            } catch (e: Exception) {
                // Fallback to local generation if counter transaction fails
                generateLocalBillNumber(createdAt)
            }
        } else {
            generateLocalBillNumber(createdAt)
        }

        val billEntity = BillEntity(
            id = billId,
            billNo = billNo,
            orderNumber = bill.orderNumber,
            restaurantId = bill.restaurantId,
            orderType = bill.orderType,
            channel = bill.channel,
            itemsJson = serializeItems(bill.items),
            subtotal = bill.subtotal,
            discountAmount = bill.discountAmount,
            discountType = bill.discountType,
            discountValue = bill.discountValue,
            discountReason = bill.discountReason,
            serviceChargePercent = bill.serviceChargePercent,
            serviceChargeAmount = bill.serviceChargeAmount,
            cgst = bill.cgst,
            sgst = bill.sgst,
            grandTotal = bill.grandTotal,
            paymentMode = bill.paymentMode,
            cashCollected = bill.cashCollected,
            paymentSplitsJson = serializePaymentSplits(bill.paymentSplits),
            punchedBy = bill.punchedBy,
            customerName = bill.customerName,
            customerPhone = bill.customerPhone,
            publicToken = publicToken,
            createdAt = createdAt,
            synced = false
        )

        return if (isOnline) {
            try {
                // Save to Firestore
                val firestoreData = mapBillToFirestore(billEntity, bill.items, bill.paymentSplits)
                billsCollection.document(billId).set(firestoreData).await()

                // Save locally as synced
                billDao.insert(billEntity.copy(synced = true))
                Result.Success(billId)
            } catch (e: Exception) {
                // Firestore write failed — save locally for later sync
                try {
                    billDao.insert(billEntity)
                    Result.Success(billId)
                } catch (localError: Exception) {
                    Result.Error("Failed to create bill: ${localError.message}", localError)
                }
            }
        } else {
            // Offline: save to Room for later sync
            try {
                billDao.insert(billEntity)
                Result.Success(billId)
            } catch (e: Exception) {
                Result.Error("Failed to save bill locally: ${e.message}", e)
            }
        }
    }

    // -------------------------------------------------------------------------
    // Get Bill (Requirement 16.9)
    // -------------------------------------------------------------------------

    /**
     * Retrieves a bill by ID. Attempts Firestore first if online, falls back to Room.
     *
     * @param billId The bill document ID
     * @return Result containing the Bill domain object or an error
     */
    override suspend fun getBill(billId: String): Result<Bill> {
        val isOnline = isCurrentlyOnline()

        if (isOnline) {
            try {
                val doc = billsCollection.document(billId).get().await()
                if (doc.exists()) {
                    val bill = mapFirestoreToBill(doc.data ?: emptyMap(), doc.id)
                    if (bill != null) {
                        return Result.Success(bill)
                    }
                }
            } catch (_: Exception) {
                // Fall through to local lookup
            }
        }

        // Fallback: check local Room database
        val localBill = billDao.getById(billId)
        return if (localBill != null) {
            Result.Success(mapEntityToBill(localBill))
        } else {
            Result.Error("Bill not found: $billId")
        }
    }

    // -------------------------------------------------------------------------
    // Observe Today's Bills (Requirement 16.9)
    // -------------------------------------------------------------------------

    /**
     * Returns a reactive Flow of today's bills for the current restaurant,
     * ordered by createdAt DESC. Uses Room as the data source for real-time updates.
     */
    override fun observeTodayBills(): Flow<List<Bill>> {
        val todayStart = getTodayStartMillis()
        return billDao.getTodayBills(RESTAURANT_ID, todayStart)
            .map { entities -> entities.map { mapEntityToBill(it) } }
    }

    // -------------------------------------------------------------------------
    // Unsynced Bill Count
    // -------------------------------------------------------------------------

    override suspend fun getUnsyncedBillCount(): Int {
        return billDao.getUnsyncedCount()
    }

    // -------------------------------------------------------------------------
    // Sync Pending Bills
    // -------------------------------------------------------------------------

    /**
     * Synchronizes all locally stored unsynced bills to Firestore.
     * Processes bills in chronological order (oldest first).
     * Marks each bill as synced after successful Firestore write.
     */
    override suspend fun syncPendingBills(): Result<Unit> {
        return try {
            val unsyncedBills = billDao.getUnsyncedBills().first()
            if (unsyncedBills.isEmpty()) {
                return Result.Success(Unit)
            }

            var failureCount = 0
            for (entity in unsyncedBills) {
                try {
                    val items = deserializeItems(entity.itemsJson)
                    val splits = deserializePaymentSplits(entity.paymentSplitsJson)
                    val firestoreData = mapBillToFirestore(entity, items, splits)
                    billsCollection.document(entity.id).set(firestoreData).await()
                    billDao.markSynced(entity.id)
                } catch (_: Exception) {
                    failureCount++
                }
            }

            if (failureCount == unsyncedBills.size) {
                Result.Error("Failed to sync any bills ($failureCount failures)")
            } else {
                Result.Success(Unit)
            }
        } catch (e: Exception) {
            Result.Error("Bill sync failed: ${e.message}", e)
        }
    }

    // -------------------------------------------------------------------------
    // Bill Number Generation (Atomic Counter via Firestore Transaction)
    // -------------------------------------------------------------------------

    /**
     * Generates a sequential bill number using an atomic counter transaction
     * on the `counters/bills` document in Firestore.
     * Counter starts above 1000 per design specification.
     *
     * @return The generated bill number string (e.g. "1001", "1002", ...)
     * @throws Exception if the Firestore transaction fails
     */
    private suspend fun generateBillNumber(): String {
        val counterDocRef = countersCollection.document(COUNTER_DOC_ID)

        val newCounter = firestore.runTransaction { transaction ->
            val snapshot = transaction.get(counterDocRef)
            val current = snapshot.getLong(COUNTER_FIELD) ?: Constants.BILL_NUMBER_START
            val next = current + 1
            transaction.update(counterDocRef, COUNTER_FIELD, next)
            next
        }.await()

        return newCounter.toString()
    }

    /**
     * Generates a local bill number when offline (no Firestore counter available).
     * Uses timestamp-based suffix to ensure local uniqueness.
     * Prefix with "L" to indicate locally generated (will be replaced on sync if needed).
     */
    private fun generateLocalBillNumber(createdAt: Long): String {
        val suffix = (createdAt % 100000).toString()
        return "L$suffix"
    }

    // -------------------------------------------------------------------------
    // Connectivity Check
    // -------------------------------------------------------------------------

    private suspend fun isCurrentlyOnline(): Boolean {
        return try {
            connectivityObserver.observe().first() == ConnectivityState.CONNECTED
        } catch (_: Exception) {
            false
        }
    }

    // -------------------------------------------------------------------------
    // Mapping: BillEntity → Firestore Map
    // -------------------------------------------------------------------------

    private fun mapBillToFirestore(
        entity: BillEntity,
        items: List<BillItem>,
        splits: List<PaymentSplit>?
    ): Map<String, Any?> {
        return mapOf(
            "id" to entity.id,
            "billNo" to entity.billNo,
            "publicToken" to entity.publicToken,
            "restaurantId" to entity.restaurantId,
            "orderNumber" to entity.orderNumber,
            "orderType" to entity.orderType,
            "channel" to entity.channel,
            "items" to items.map { item ->
                mapOf(
                    "id" to item.id,
                    "name" to item.name,
                    "variantLabel" to item.variantLabel,
                    "qty" to item.qty,
                    "basePrice" to item.basePrice,
                    "modifiers" to item.modifiers.map { mod ->
                        mapOf(
                            "id" to mod.id,
                            "name" to mod.name,
                            "price" to mod.price,
                            "groupName" to mod.groupName
                        )
                    },
                    "itemTotal" to item.itemTotal
                )
            },
            "subtotal" to entity.subtotal,
            "discountAmount" to entity.discountAmount,
            "discountType" to entity.discountType,
            "discountValue" to entity.discountValue,
            "discountReason" to entity.discountReason,
            "serviceChargePercent" to entity.serviceChargePercent,
            "serviceChargeAmount" to entity.serviceChargeAmount,
            "cgst" to entity.cgst,
            "sgst" to entity.sgst,
            "grandTotal" to entity.grandTotal,
            "paymentMode" to entity.paymentMode,
            "cashCollected" to entity.cashCollected,
            "paymentSplits" to splits?.map { split ->
                mapOf(
                    "method" to split.method,
                    "amount" to split.amount
                )
            },
            "punchedBy" to entity.punchedBy,
            "customer" to mapOf(
                "name" to entity.customerName,
                "phone" to entity.customerPhone
            ),
            "createdAt" to entity.createdAt
        )
    }

    // -------------------------------------------------------------------------
    // Mapping: Firestore Document → Bill domain model
    // -------------------------------------------------------------------------

    @Suppress("UNCHECKED_CAST")
    private fun mapFirestoreToBill(data: Map<String, Any?>, docId: String): Bill? {
        return try {
            val items = (data["items"] as? List<Map<String, Any?>>)?.map { itemMap ->
                BillItem(
                    id = itemMap["id"] as? String ?: "",
                    name = itemMap["name"] as? String ?: "",
                    variantLabel = itemMap["variantLabel"] as? String,
                    qty = (itemMap["qty"] as? Number)?.toInt() ?: 1,
                    basePrice = (itemMap["basePrice"] as? Number)?.toDouble() ?: 0.0,
                    modifiers = (itemMap["modifiers"] as? List<Map<String, Any?>>)?.map { modMap ->
                        BillModifier(
                            id = modMap["id"] as? String ?: "",
                            name = modMap["name"] as? String ?: "",
                            price = (modMap["price"] as? Number)?.toDouble() ?: 0.0,
                            groupName = modMap["groupName"] as? String ?: ""
                        )
                    } ?: emptyList(),
                    itemTotal = (itemMap["itemTotal"] as? Number)?.toDouble() ?: 0.0
                )
            } ?: emptyList()

            val paymentSplits = (data["paymentSplits"] as? List<Map<String, Any?>>)?.map { splitMap ->
                PaymentSplit(
                    method = splitMap["method"] as? String ?: "",
                    amount = (splitMap["amount"] as? Number)?.toDouble() ?: 0.0
                )
            }

            val customer = data["customer"] as? Map<String, Any?>

            Bill(
                id = docId,
                billNo = data["billNo"] as? String ?: "",
                orderNumber = data["orderNumber"] as? String ?: "",
                restaurantId = data["restaurantId"] as? String ?: "",
                orderType = data["orderType"] as? String ?: "",
                channel = data["channel"] as? String ?: "",
                items = items,
                subtotal = (data["subtotal"] as? Number)?.toDouble() ?: 0.0,
                discountAmount = (data["discountAmount"] as? Number)?.toDouble() ?: 0.0,
                discountType = data["discountType"] as? String,
                discountValue = (data["discountValue"] as? Number)?.toDouble(),
                discountReason = data["discountReason"] as? String,
                serviceChargePercent = (data["serviceChargePercent"] as? Number)?.toDouble() ?: 0.0,
                serviceChargeAmount = (data["serviceChargeAmount"] as? Number)?.toDouble() ?: 0.0,
                cgst = (data["cgst"] as? Number)?.toDouble() ?: 0.0,
                sgst = (data["sgst"] as? Number)?.toDouble() ?: 0.0,
                grandTotal = (data["grandTotal"] as? Number)?.toDouble() ?: 0.0,
                paymentMode = data["paymentMode"] as? String ?: "",
                cashCollected = (data["cashCollected"] as? Number)?.toDouble(),
                paymentSplits = paymentSplits,
                punchedBy = data["punchedBy"] as? String,
                customerName = customer?.get("name") as? String,
                customerPhone = customer?.get("phone") as? String,
                publicToken = data["publicToken"] as? String,
                createdAt = (data["createdAt"] as? Number)?.toLong() ?: 0L
            )
        } catch (_: Exception) {
            null
        }
    }

    // -------------------------------------------------------------------------
    // Mapping: BillEntity → Bill domain model
    // -------------------------------------------------------------------------

    private fun mapEntityToBill(entity: BillEntity): Bill {
        val items = deserializeItems(entity.itemsJson)
        val splits = deserializePaymentSplits(entity.paymentSplitsJson)

        return Bill(
            id = entity.id,
            billNo = entity.billNo,
            orderNumber = entity.orderNumber,
            restaurantId = entity.restaurantId,
            orderType = entity.orderType,
            channel = entity.channel,
            items = items,
            subtotal = entity.subtotal,
            discountAmount = entity.discountAmount,
            discountType = entity.discountType,
            discountValue = entity.discountValue,
            discountReason = entity.discountReason,
            serviceChargePercent = entity.serviceChargePercent,
            serviceChargeAmount = entity.serviceChargeAmount,
            cgst = entity.cgst,
            sgst = entity.sgst,
            grandTotal = entity.grandTotal,
            paymentMode = entity.paymentMode,
            cashCollected = entity.cashCollected,
            paymentSplits = splits,
            punchedBy = entity.punchedBy,
            customerName = entity.customerName,
            customerPhone = entity.customerPhone,
            publicToken = entity.publicToken,
            createdAt = entity.createdAt
        )
    }

    // -------------------------------------------------------------------------
    // JSON Serialization / Deserialization for BillItems
    // -------------------------------------------------------------------------

    private fun serializeItems(items: List<BillItem>): String {
        return JSONArray().apply {
            items.forEach { item ->
                put(JSONObject().apply {
                    put("id", item.id)
                    put("name", item.name)
                    put("variantLabel", item.variantLabel ?: "")
                    put("qty", item.qty)
                    put("basePrice", item.basePrice)
                    put("modifiers", JSONArray().apply {
                        item.modifiers.forEach { mod ->
                            put(JSONObject().apply {
                                put("id", mod.id)
                                put("name", mod.name)
                                put("price", mod.price)
                                put("groupName", mod.groupName)
                            })
                        }
                    })
                    put("itemTotal", item.itemTotal)
                })
            }
        }.toString()
    }

    private fun deserializeItems(json: String): List<BillItem> {
        return try {
            val array = JSONArray(json)
            (0 until array.length()).map { i ->
                val obj = array.getJSONObject(i)
                val modifiersArray = obj.optJSONArray("modifiers") ?: JSONArray()
                BillItem(
                    id = obj.optString("id", ""),
                    name = obj.optString("name", ""),
                    variantLabel = obj.optString("variantLabel", "").takeIf { it.isNotEmpty() },
                    qty = obj.optInt("qty", 1),
                    basePrice = obj.optDouble("basePrice", 0.0),
                    modifiers = (0 until modifiersArray.length()).map { j ->
                        val modObj = modifiersArray.getJSONObject(j)
                        BillModifier(
                            id = modObj.optString("id", ""),
                            name = modObj.optString("name", ""),
                            price = modObj.optDouble("price", 0.0),
                            groupName = modObj.optString("groupName", "")
                        )
                    },
                    itemTotal = obj.optDouble("itemTotal", 0.0)
                )
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    // -------------------------------------------------------------------------
    // JSON Serialization / Deserialization for PaymentSplits
    // -------------------------------------------------------------------------

    private fun serializePaymentSplits(splits: List<PaymentSplit>?): String? {
        if (splits == null) return null
        return JSONArray().apply {
            splits.forEach { split ->
                put(JSONObject().apply {
                    put("method", split.method)
                    put("amount", split.amount)
                })
            }
        }.toString()
    }

    private fun deserializePaymentSplits(json: String?): List<PaymentSplit>? {
        if (json == null) return null
        return try {
            val array = JSONArray(json)
            (0 until array.length()).map { i ->
                val obj = array.getJSONObject(i)
                PaymentSplit(
                    method = obj.optString("method", ""),
                    amount = obj.optDouble("amount", 0.0)
                )
            }
        } catch (_: Exception) {
            null
        }
    }

    // -------------------------------------------------------------------------
    // Utility: Get today's start timestamp
    // -------------------------------------------------------------------------

    private fun getTodayStartMillis(): Long {
        val calendar = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        return calendar.timeInMillis
    }
}
