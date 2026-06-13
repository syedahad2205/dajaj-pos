package com.dajaj.pos.data.repository

import com.dajaj.pos.common.Result
import com.dajaj.pos.domain.model.User
import com.dajaj.pos.domain.model.UserRole
import com.dajaj.pos.domain.model.UserStatus
import com.dajaj.pos.domain.repository.AuthRepository
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseAuthInvalidCredentialsException
import com.google.firebase.auth.FirebaseAuthInvalidUserException
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Firebase-backed implementation of [AuthRepository].
 *
 * Authenticates users via Firebase Auth and resolves their role from the
 * existing Firestore schema:
 *   - /admins/{uid}          → ADMIN role
 *   - /pos_staff/{email}     → CASHIER or MANAGER role (based on canManageInventory)
 */
@Singleton
class AuthRepositoryImpl @Inject constructor(
    private val firebaseAuth: FirebaseAuth,
    private val firestore: FirebaseFirestore
) : AuthRepository {

    override suspend fun signIn(email: String, password: String): Result<User> {
        return try {
            val authResult = firebaseAuth.signInWithEmailAndPassword(email, password).await()
            val firebaseUser = authResult.user
                ?: return Result.Error("Authentication failed")

            resolveUser(firebaseUser.uid, firebaseUser.email ?: email)
        } catch (e: FirebaseAuthInvalidCredentialsException) {
            Result.Error("Invalid email or password")
        } catch (e: FirebaseAuthInvalidUserException) {
            Result.Error("Invalid email or password")
        } catch (e: Exception) {
            if (isNetworkError(e)) {
                Result.Error("Unable to connect. Check your internet")
            } else {
                Result.Error("Invalid email or password")
            }
        }
    }

    override suspend fun signOut() {
        firebaseAuth.signOut()
    }

    override suspend fun getCurrentUser(): Result<User?> {
        val currentUser = firebaseAuth.currentUser ?: return Result.Success(null)
        return try {
            when (val result = resolveUser(currentUser.uid, currentUser.email ?: "")) {
                is Result.Success -> Result.Success(result.data)
                is Result.Error -> result
                is Result.Loading -> result
            }
        } catch (e: Exception) {
            if (isNetworkError(e)) {
                Result.Error("Unable to connect. Check your internet")
            } else {
                Result.Error(e.message ?: "Failed to fetch user data")
            }
        }
    }

    override suspend fun resetPassword(email: String): Result<Unit> {
        return try {
            firebaseAuth.sendPasswordResetEmail(email).await()
            Result.Success(Unit)
        } catch (e: Exception) {
            if (isNetworkError(e)) {
                Result.Error("Unable to connect. Check your internet")
            } else {
                Result.Error(e.message ?: "Failed to send reset email")
            }
        }
    }

    override fun isLoggedIn(): Boolean {
        return firebaseAuth.currentUser != null
    }

    /**
     * Resolves the user's role by checking /admins/{uid} first, then /pos_staff/{email}.
     *
     * Admin check:    /admins/{uid} exists → ADMIN / ACTIVE
     * POS staff check: /pos_staff/{email} → status maps to UserStatus, role from canManageInventory
     */
    private suspend fun resolveUser(uid: String, email: String): Result<User> {
        return try {
            // 1. Check if admin
            val adminDoc = firestore.collection("admins").document(uid).get().await()
            if (adminDoc.exists()) {
                return Result.Success(
                    User(
                        id = uid,
                        email = email,
                        name = adminDoc.getString("name") ?: email,
                        role = UserRole.ADMIN,
                        status = UserStatus.ACTIVE
                    )
                )
            }

            // 2. Check pos_staff keyed by lowercase email
            val staffEmail = email.lowercase()
            val staffDoc = firestore.collection("pos_staff").document(staffEmail).get().await()

            if (!staffDoc.exists()) {
                return Result.Error("No account found. Contact your administrator.")
            }

            val statusStr = staffDoc.getString("status") ?: "pending"
            val status = when (statusStr.lowercase()) {
                "active" -> UserStatus.ACTIVE
                "rejected" -> UserStatus.REJECTED
                else -> UserStatus.PENDING
            }

            if (status == UserStatus.PENDING) {
                return Result.Error("Your account is pending approval")
            }
            if (status == UserStatus.REJECTED) {
                return Result.Error("Access denied. Contact administrator")
            }

            val canManageInventory = staffDoc.getBoolean("canManageInventory") ?: false
            val role = if (canManageInventory) UserRole.MANAGER else UserRole.CASHIER

            Result.Success(
                User(
                    id = uid,
                    email = email,
                    name = staffDoc.getString("name") ?: email,
                    role = role,
                    status = UserStatus.ACTIVE
                )
            )
        } catch (e: Exception) {
            if (isNetworkError(e)) {
                Result.Error("Unable to connect. Check your internet")
            } else {
                Result.Error(e.message ?: "Failed to fetch user data")
            }
        }
    }

    private fun isNetworkError(e: Exception): Boolean {
        val message = e.message?.lowercase() ?: ""
        return e is java.net.UnknownHostException ||
            e is java.net.ConnectException ||
            e is java.net.SocketTimeoutException ||
            message.contains("network") ||
            message.contains("unable to resolve host") ||
            message.contains("failed to connect")
    }
}
