package com.dajaj.pos.domain.repository

import com.dajaj.pos.common.Result
import com.dajaj.pos.domain.model.User

/**
 * Repository interface for authentication operations.
 * Implementations live in the data layer.
 */
interface AuthRepository {

    /**
     * Signs in a user with email and password credentials.
     */
    suspend fun signIn(email: String, password: String): Result<User>

    /**
     * Signs out the currently authenticated user.
     */
    suspend fun signOut()

    /**
     * Returns the currently authenticated user, or null if not signed in.
     */
    suspend fun getCurrentUser(): Result<User?>

    /**
     * Sends a password reset email to the given address.
     */
    suspend fun resetPassword(email: String): Result<Unit>

    /**
     * Returns whether there is a currently authenticated session.
     */
    fun isLoggedIn(): Boolean
}
