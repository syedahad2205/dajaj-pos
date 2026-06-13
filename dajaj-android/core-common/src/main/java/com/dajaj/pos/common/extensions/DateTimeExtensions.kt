package com.dajaj.pos.common.extensions

import java.text.SimpleDateFormat
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Formats a timestamp (epoch millis) to a human-readable date-time string.
 * Example: "15 Jan 2024, 02:30 PM"
 */
fun Long.toFormattedDateTime(
    pattern: String = "dd MMM yyyy, hh:mm a",
    timeZone: TimeZone = TimeZone.getDefault()
): String {
    val sdf = SimpleDateFormat(pattern, Locale.getDefault())
    sdf.timeZone = timeZone
    return sdf.format(Date(this))
}

/**
 * Formats a timestamp (epoch millis) to a time-only string.
 * Example: "02:30 PM"
 */
fun Long.toFormattedTime(
    pattern: String = "hh:mm a",
    timeZone: TimeZone = TimeZone.getDefault()
): String {
    val sdf = SimpleDateFormat(pattern, Locale.getDefault())
    sdf.timeZone = timeZone
    return sdf.format(Date(this))
}

/**
 * Formats a timestamp (epoch millis) to a date-only string.
 * Example: "15 Jan 2024"
 */
fun Long.toFormattedDate(
    pattern: String = "dd MMM yyyy",
    timeZone: TimeZone = TimeZone.getDefault()
): String {
    val sdf = SimpleDateFormat(pattern, Locale.getDefault())
    sdf.timeZone = timeZone
    return sdf.format(Date(this))
}

/**
 * Generates the order number date prefix in DDMMYY format from a timestamp (epoch millis).
 * Example: 1705312200000 → "150124" (15 Jan 2024)
 */
fun Long.toOrderDatePrefix(timeZone: TimeZone = TimeZone.getDefault()): String {
    val sdf = SimpleDateFormat("ddMMyy", Locale.getDefault())
    sdf.timeZone = timeZone
    return sdf.format(Date(this))
}

/**
 * Converts a timestamp (epoch millis) to [LocalDateTime] in the given timezone.
 */
fun Long.toLocalDateTime(zoneId: ZoneId = ZoneId.systemDefault()): LocalDateTime {
    return Instant.ofEpochMilli(this)
        .atZone(zoneId)
        .toLocalDateTime()
}

/**
 * Converts a timestamp (epoch millis) to [LocalDate] in the given timezone.
 */
fun Long.toLocalDate(zoneId: ZoneId = ZoneId.systemDefault()): LocalDate {
    return Instant.ofEpochMilli(this)
        .atZone(zoneId)
        .toLocalDate()
}

/**
 * Returns the elapsed time from this timestamp to now as a human-readable string.
 * Examples: "2m ago", "1h 15m ago", "3d ago"
 */
fun Long.toElapsedTime(): String {
    val now = System.currentTimeMillis()
    val diffMs = now - this
    val minutes = diffMs / 60_000
    val hours = minutes / 60
    val days = hours / 24

    return when {
        days > 0 -> "${days}d ago"
        hours > 0 -> "${hours}h ${minutes % 60}m ago"
        minutes > 0 -> "${minutes}m ago"
        else -> "Just now"
    }
}

/**
 * Formats a [LocalDateTime] using the given [pattern].
 */
fun LocalDateTime.format(pattern: String): String {
    return this.format(DateTimeFormatter.ofPattern(pattern, Locale.getDefault()))
}

/**
 * Returns the start of day (00:00:00) for this [LocalDate] in epoch millis.
 */
fun LocalDate.startOfDayMillis(zoneId: ZoneId = ZoneId.systemDefault()): Long {
    return this.atStartOfDay(zoneId).toInstant().toEpochMilli()
}

/**
 * Returns the end of day (23:59:59.999) for this [LocalDate] in epoch millis.
 */
fun LocalDate.endOfDayMillis(zoneId: ZoneId = ZoneId.systemDefault()): Long {
    return this.atStartOfDay(zoneId)
        .plusDays(1)
        .toInstant()
        .toEpochMilli() - 1
}

/**
 * Returns the number of days between this date and [other].
 */
fun LocalDate.daysBetween(other: LocalDate): Long {
    return ChronoUnit.DAYS.between(this, other)
}
