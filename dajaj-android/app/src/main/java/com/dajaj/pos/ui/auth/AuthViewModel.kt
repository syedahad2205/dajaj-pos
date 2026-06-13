package com.dajaj.pos.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dajaj.pos.common.Result
import com.dajaj.pos.domain.model.User
import com.dajaj.pos.domain.model.UserStatus
import com.dajaj.pos.domain.repository.AuthRepository
import com.dajaj.pos.domain.usecase.auth.SignInUseCase
import com.dajaj.pos.domain.usecase.auth.ValidateRoleUseCase
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * ViewModel managing authentication state for the login screen.
 * Handles the login flow: validate inputs → sign in → validate role → emit result.
 */
@HiltViewModel
class AuthViewModel @Inject constructor(
    private val signInUseCase: SignInUseCase,
    private val validateRoleUseCase: ValidateRoleUseCase,
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _authState = MutableStateFlow<AuthState>(AuthState.Idle)
    val authState: StateFlow<AuthState> = _authState.asStateFlow()

    /**
     * Attempts to log in with the given credentials.
     * Flow: Loading → SignIn → ValidateRole → Success or Error.
     */
    fun login(email: String, password: String) {
        viewModelScope.launch {
            _authState.value = AuthState.Loading

            when (val signInResult = signInUseCase(email, password)) {
                is Result.Success -> {
                    val user = signInResult.data
                    handleSignInSuccess(user)
                }
                is Result.Error -> {
                    _authState.value = AuthState.Error(mapSignInError(signInResult.message))
                }
                is Result.Loading -> {
                    // Should not occur from use case, but handle gracefully
                }
            }
        }
    }

    /**
     * Validates the user's role and status after successful sign-in.
     */
    private fun handleSignInSuccess(user: User) {
        when (user.status) {
            UserStatus.PENDING -> {
                _authState.value = AuthState.Error(AuthError.PENDING_ACCOUNT)
            }
            UserStatus.REJECTED -> {
                _authState.value = AuthState.Error(AuthError.REJECTED_ACCOUNT)
            }
            UserStatus.ACTIVE -> {
                when (val roleResult = validateRoleUseCase(user)) {
                    is Result.Success -> {
                        if (roleResult.data) {
                            _authState.value = AuthState.Success(user)
                        } else {
                            _authState.value = AuthState.Error(AuthError.REJECTED_ACCOUNT)
                        }
                    }
                    is Result.Error -> {
                        _authState.value = AuthState.Error(AuthError.GENERIC)
                    }
                    is Result.Loading -> {}
                }
            }
        }
    }

    /**
     * Sends a password reset email.
     */
    fun resetPassword(email: String) {
        viewModelScope.launch {
            _authState.value = AuthState.Loading
            when (authRepository.resetPassword(email)) {
                is Result.Success -> {
                    _authState.value = AuthState.PasswordResetSent
                }
                is Result.Error -> {
                    _authState.value = AuthState.Error(AuthError.RESET_PASSWORD_FAILED)
                }
                is Result.Loading -> {}
            }
        }
    }

    /**
     * Resets the auth state back to Idle.
     */
    fun clearError() {
        _authState.value = AuthState.Idle
    }

    /**
     * Maps sign-in error messages to typed auth errors.
     */
    private fun mapSignInError(message: String): AuthError {
        return when {
            message.contains("invalid", ignoreCase = true) ||
            message.contains("credentials", ignoreCase = true) ||
            message.contains("password", ignoreCase = true) ||
            message.contains("email", ignoreCase = true) -> AuthError.INVALID_CREDENTIALS

            message.contains("network", ignoreCase = true) ||
            message.contains("connect", ignoreCase = true) ||
            message.contains("timeout", ignoreCase = true) -> AuthError.NETWORK_ERROR

            message.contains("pending", ignoreCase = true) -> AuthError.PENDING_ACCOUNT
            message.contains("rejected", ignoreCase = true) -> AuthError.REJECTED_ACCOUNT

            else -> AuthError.GENERIC
        }
    }
}

/**
 * Sealed class representing the authentication UI state.
 */
sealed class AuthState {
    /** Initial state, no action taken. */
    data object Idle : AuthState()

    /** Authentication is in progress. */
    data object Loading : AuthState()

    /** Authentication succeeded with the given user. */
    data class Success(val user: User) : AuthState()

    /** Authentication failed with a typed error. */
    data class Error(val error: AuthError) : AuthState()

    /** Password reset email was sent successfully. */
    data object PasswordResetSent : AuthState()
}

/**
 * Typed authentication errors for UI display.
 */
enum class AuthError {
    INVALID_CREDENTIALS,
    PENDING_ACCOUNT,
    REJECTED_ACCOUNT,
    NETWORK_ERROR,
    RESET_PASSWORD_FAILED,
    GENERIC
}
