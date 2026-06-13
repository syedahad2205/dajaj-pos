package com.dajaj.pos.ui.auth

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.view.isVisible
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.dajaj.pos.R
import com.dajaj.pos.databinding.FragmentLoginBinding
import com.dajaj.pos.ui.main.MainActivity
import com.google.android.material.snackbar.Snackbar
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch

/**
 * Login screen fragment handling user authentication.
 * Validates inputs, calls the AuthViewModel, and reacts to auth state changes.
 */
@AndroidEntryPoint
class LoginFragment : Fragment() {

    private var _binding: FragmentLoginBinding? = null
    private val binding get() = _binding!!

    private val viewModel: AuthViewModel by viewModels()

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentLoginBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        setupListeners()
        observeAuthState()
    }

    private fun setupListeners() {
        binding.btnSignIn.setOnClickListener {
            clearFieldErrors()
            val email = binding.etEmail.text?.toString().orEmpty().trim()
            val password = binding.etPassword.text?.toString().orEmpty()

            if (validateInputs(email, password)) {
                viewModel.login(email, password)
            }
        }

        binding.btnForgotPassword.setOnClickListener {
            val email = binding.etEmail.text?.toString().orEmpty().trim()
            if (email.isBlank()) {
                binding.tilEmail.error = getString(R.string.login_error_invalid_email)
            } else {
                viewModel.resetPassword(email)
            }
        }
    }

    private fun observeAuthState() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.authState.collect { state ->
                    when (state) {
                        is AuthState.Idle -> {
                            setLoadingState(false)
                            hideError()
                        }
                        is AuthState.Loading -> {
                            setLoadingState(true)
                            hideError()
                        }
                        is AuthState.Success -> {
                            setLoadingState(false)
                            navigateToDashboard()
                        }
                        is AuthState.Error -> {
                            setLoadingState(false)
                            showError(state.error)
                        }
                        is AuthState.PasswordResetSent -> {
                            setLoadingState(false)
                            Snackbar.make(
                                binding.root,
                                R.string.login_reset_password_success,
                                Snackbar.LENGTH_LONG
                            ).show()
                            viewModel.clearError()
                        }
                    }
                }
            }
        }
    }

    /**
     * Validates email format and password length before login attempt.
     * Returns true if inputs are valid; otherwise, sets inline errors and returns false.
     */
    private fun validateInputs(email: String, password: String): Boolean {
        var isValid = true

        if (email.isBlank() || !isValidEmail(email)) {
            binding.tilEmail.error = getString(R.string.login_error_invalid_email)
            isValid = false
        }

        if (password.length < MIN_PASSWORD_LENGTH) {
            binding.tilPassword.error = getString(R.string.login_error_password_short)
            isValid = false
        }

        return isValid
    }

    private fun isValidEmail(email: String): Boolean {
        val emailRegex = Regex("^[A-Za-z0-9+_.-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$")
        return emailRegex.matches(email)
    }

    private fun clearFieldErrors() {
        binding.tilEmail.error = null
        binding.tilPassword.error = null
    }

    /**
     * Shows or hides the loading state. During loading:
     * - Sign In button text becomes invisible (button still visible for layout)
     * - Progress indicator shows on top of the button
     * - Input fields and forgot password are disabled
     */
    private fun setLoadingState(loading: Boolean) {
        binding.progressLoading.isVisible = loading
        binding.btnSignIn.isEnabled = !loading
        binding.btnSignIn.text = if (loading) "" else getString(R.string.login_sign_in)
        binding.etEmail.isEnabled = !loading
        binding.etPassword.isEnabled = !loading
        binding.btnForgotPassword.isEnabled = !loading
    }

    /**
     * Displays the appropriate error message for the auth error type.
     */
    private fun showError(error: AuthError) {
        val message = when (error) {
            AuthError.INVALID_CREDENTIALS -> getString(R.string.login_error_invalid_credentials)
            AuthError.PENDING_ACCOUNT -> getString(R.string.login_error_pending_account)
            AuthError.REJECTED_ACCOUNT -> getString(R.string.login_error_rejected_account)
            AuthError.NETWORK_ERROR -> getString(R.string.login_error_network)
            AuthError.RESET_PASSWORD_FAILED -> getString(R.string.login_reset_password_error)
            AuthError.GENERIC -> getString(R.string.login_error_generic)
        }
        binding.tvError.text = message
        binding.tvError.isVisible = true
    }

    private fun hideError() {
        binding.tvError.isVisible = false
        binding.tvError.text = ""
    }

    /**
     * Navigates to the main dashboard activity and finishes the auth activity.
     */
    private fun navigateToDashboard() {
        val intent = Intent(requireContext(), MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        }
        startActivity(intent)
        requireActivity().finish()
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    companion object {
        private const val MIN_PASSWORD_LENGTH = 6
    }
}
