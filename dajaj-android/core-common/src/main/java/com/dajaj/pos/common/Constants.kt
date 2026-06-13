package com.dajaj.pos.common

/**
 * System-wide constants for the Dajaj POS ecosystem.
 */
object Constants {

    // --- Heartbeat & Device Registry ---
    /** Interval between heartbeat updates to Firestore (30 seconds). */
    const val HEARTBEAT_INTERVAL_MS = 30_000L

    /** Threshold after which a device is considered offline (90 seconds). */
    const val DEVICE_OFFLINE_THRESHOLD_MS = 90_000L

    // --- Print Retry ---
    /** Maximum number of print retry attempts. */
    const val PRINT_RETRY_MAX = 3

    /** Base delay for exponential backoff on print retries (2s, 4s, 8s). */
    const val PRINT_RETRY_BASE_DELAY_MS = 2000L

    // --- Sync Retry ---
    /** Maximum number of sync retry attempts. */
    const val SYNC_RETRY_MAX = 5

    // --- Queue Capacities ---
    /** Maximum offline orders stored locally in Room. */
    const val OFFLINE_ORDER_QUEUE_MAX = 500

    /** Maximum offline print jobs stored locally in Room. */
    const val OFFLINE_PRINT_QUEUE_MAX = 500

    // --- Printer Connection ---
    /** Interval between auto-reconnection attempts (5 seconds). */
    const val PRINTER_RECONNECT_INTERVAL_MS = 5000L

    /** Total timeout for auto-reconnection attempts (60 seconds). */
    const val PRINTER_RECONNECT_TIMEOUT_MS = 60_000L

    /** Timeout for a single print operation (30 seconds). */
    const val PRINT_TIMEOUT_MS = 30_000L

    // --- Bluetooth ---
    /** Timeout for Bluetooth device scan (15 seconds). */
    const val BLUETOOTH_SCAN_TIMEOUT_MS = 15_000L

    /** Maximum number of paired printers. */
    const val MAX_PAIRED_PRINTERS = 5

    // --- Kitchen ---
    /** Time after which an order in PREPARING state is marked overdue (30 minutes). */
    const val OVERDUE_THRESHOLD_MS = 1_800_000L

    // --- Favorites ---
    /** Maximum number of items in the Favorites section. */
    const val FAVORITES_MAX_ITEMS = 20

    // --- Rejection ---
    /** Minimum length for rejection reason text. */
    const val REJECTION_REASON_MIN = 1

    /** Maximum length for rejection reason text. */
    const val REJECTION_REASON_MAX = 200

    // --- Order Numbering ---
    /** Starting value for sequential order numbers. */
    const val ORDER_NUMBER_START = 1000L

    // --- Firestore Collection Names ---
    const val COLLECTION_MENUS = "menus"
    const val COLLECTION_ORDERS = "orders"
    const val COLLECTION_PENDING_ORDERS = "pending_orders"
    const val COLLECTION_PRINT_JOBS = "print_jobs"
    const val COLLECTION_DEVICES = "devices"
    const val COLLECTION_USERS = "users"
    const val COLLECTION_BILLS = "bills"
    const val COLLECTION_COUNTERS = "counters"
}
