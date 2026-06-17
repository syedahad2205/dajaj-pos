package com.dajaj.pos.domain.model

/**
 * Identifies the origin of a print request.
 *
 * Print jobs can be created either from the Android POS application
 * or remotely from the Web Dashboard.
 */
enum class PrintSource {
    /** Print initiated from the Android POS cashier interface. */
    ANDROID_POS,

    /** Print initiated remotely from the Web Dashboard by a manager. */
    WEB_DASHBOARD;

    companion object {
        fun fromString(value: String): PrintSource = when (value.lowercase()) {
            "android_pos" -> ANDROID_POS
            "web_dashboard" -> WEB_DASHBOARD
            else -> ANDROID_POS
        }
    }

    fun toFirestoreValue(): String = when (this) {
        ANDROID_POS -> "android_pos"
        WEB_DASHBOARD -> "web_dashboard"
    }
}
