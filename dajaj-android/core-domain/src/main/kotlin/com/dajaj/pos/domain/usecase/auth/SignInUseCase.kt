package com.dajaj.pos.domain.usecase.auth

import com.dajaj.pos.common.Result
import com.dajaj.pos.domain.model.User
import com.dajaj.pos.domain.repository.AuthRepository
import javax.inject.Inject

/**
 * Use case for signing in a user. Validates email format and password length
 * before delegating to the repository.
 */
class SignInUseCase @Inject constructor(
    private val authRepository: AuthRepository
) {

    suspend operator fun invoke(email: String, password: String): Result<User> {
        if (!isValidEmail(email)) {
            return Result.Error("Invalid email format")
        }
        if (password.length < MIN_PASSWORD_LENGTH) {
            return Result.Error("Password must be at least $MIN_PASSWORD_LENGTH characters")
        }
        return authRepository.signIn(email, password)
    }

    private fun isValidEmail(email: String): Boolean {
        if (email.isBlank()) return false
        val emailRegex = Regex("^[A-Za-z0-9+_.-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$")
        return emailRegex.matches(email)
    }

    companion object {
        const val MIN_PASSWORD_LENGTH = 6
    }
}
