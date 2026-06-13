package com.dajaj.pos.domain.model

/**
 * Domain model representing a user in the Dajaj ecosystem.
 */
data class User(
    val id: String,
    val email: String,
    val name: String,
    val role: UserRole,
    val status: UserStatus
)
