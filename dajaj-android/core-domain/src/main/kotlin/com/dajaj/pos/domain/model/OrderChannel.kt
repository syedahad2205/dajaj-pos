package com.dajaj.pos.domain.model

/**
 * Identifies the source channel from which a pending order originated.
 *
 * The system accepts orders from multiple external channels through a single pipeline.
 */
enum class OrderChannel {
    WALK_IN,
    WHATSAPP,
    WEBSITE,
    QR,
    SWIGGY,
    ZOMATO;

    companion object {
        fun fromString(value: String): OrderChannel = when (value.lowercase()) {
            "walk_in" -> WALK_IN
            "whatsapp" -> WHATSAPP
            "website" -> WEBSITE
            "qr" -> QR
            "swiggy" -> SWIGGY
            "zomato" -> ZOMATO
            else -> WEBSITE
        }
    }

    fun toFirestoreValue(): String = when (this) {
        WALK_IN -> "walk_in"
        WHATSAPP -> "whatsapp"
        WEBSITE -> "website"
        QR -> "qr"
        SWIGGY -> "swiggy"
        ZOMATO -> "zomato"
    }
}
