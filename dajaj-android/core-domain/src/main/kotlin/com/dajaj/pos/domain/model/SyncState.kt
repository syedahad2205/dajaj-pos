package com.dajaj.pos.domain.model

/**
 * Represents the synchronization state between the local Room database
 * and Firestore for a given data domain (e.g., menu, orders).
 */
enum class SyncState {
    /** Data is fully synchronized with Firestore. */
    SYNCED,

    /** Synchronization is currently in progress. */
    SYNCING,

    /** Device is offline; serving from local cache. */
    OFFLINE,

    /** Synchronization encountered an error. */
    ERROR,

    /** Data has never been synced (first launch, no cache). */
    NEVER_SYNCED;

    companion object {
        fun fromString(value: String): SyncState = when (value.lowercase()) {
            "synced" -> SYNCED
            "syncing" -> SYNCING
            "offline" -> OFFLINE
            "error" -> ERROR
            "never_synced" -> NEVER_SYNCED
            else -> NEVER_SYNCED
        }
    }

    fun toFirestoreValue(): String = when (this) {
        SYNCED -> "synced"
        SYNCING -> "syncing"
        OFFLINE -> "offline"
        ERROR -> "error"
        NEVER_SYNCED -> "never_synced"
    }
}
