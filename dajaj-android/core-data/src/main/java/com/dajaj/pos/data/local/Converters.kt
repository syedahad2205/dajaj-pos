package com.dajaj.pos.data.local

import androidx.room.TypeConverter
import org.json.JSONArray
import org.json.JSONException
import java.util.Date

/**
 * Room type converters for transforming complex types to/from storable primitives.
 * Handles timestamps (Long ↔ Date), JSON arrays (String ↔ List<String>),
 * and nullable Long conversions used throughout the entity classes.
 */
class Converters {

    // --- Timestamp Converters ---

    @TypeConverter
    fun fromTimestamp(value: Long?): Date? {
        return value?.let { Date(it) }
    }

    @TypeConverter
    fun dateToTimestamp(date: Date?): Long? {
        return date?.time
    }

    // --- String List / JSON Array Converters ---

    @TypeConverter
    fun fromStringList(value: List<String>?): String? {
        if (value == null) return null
        val jsonArray = JSONArray()
        value.forEach { jsonArray.put(it) }
        return jsonArray.toString()
    }

    @TypeConverter
    fun toStringList(value: String?): List<String>? {
        if (value == null) return null
        return try {
            val jsonArray = JSONArray(value)
            (0 until jsonArray.length()).map { jsonArray.getString(it) }
        } catch (e: JSONException) {
            emptyList()
        }
    }
}
