package com.dajaj.pos.feature.settings.account

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.dajaj.pos.feature.settings.databinding.FragmentAccountSettingsBinding
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.snackbar.Snackbar
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch

/**
 * Fragment for Account and General Settings.
 *
 * Implements Requirements 16.6, 16.8, 5.4:
 * - Tax rate configuration (0-28%, default 2.5%) with input validation
 * - Service charge configuration (0-25%, default 0%) with input validation
 * - Favorites management: select up to 20 menu items to mark as favorites
 * - App version info
 * - Logout button
 */
@AndroidEntryPoint
class AccountSettingsFragment : Fragment() {

    private var _binding: FragmentAccountSettingsBinding? = null
    private val binding get() = _binding!!

    private val viewModel: AccountSettingsViewModel by viewModels()

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentAccountSettingsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        setupListeners()
        observeViewModel()
    }

    private fun setupListeners() {
        // Tax rate save
        binding.btnSaveTaxRate.setOnClickListener {
            val rateText = binding.etTaxRate.text?.toString() ?: ""
            viewModel.updateTaxRate(rateText)
        }

        // Service charge save
        binding.btnSaveServiceCharge.setOnClickListener {
            val rateText = binding.etServiceCharge.text?.toString() ?: ""
            viewModel.updateServiceCharge(rateText)
        }

        // Favorites management
        binding.btnManageFavorites.setOnClickListener {
            viewModel.openFavoritesSelector()
        }

        // Logout button
        binding.btnLogout.setOnClickListener {
            showLogoutConfirmation()
        }
    }

    private fun observeViewModel() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                // Tax rate
                launch {
                    viewModel.taxRate.collect { rate ->
                        if (!binding.etTaxRate.isFocused) {
                            binding.etTaxRate.setText(formatRate(rate))
                        }
                    }
                }

                // Tax rate error
                launch {
                    viewModel.taxRateError.collect { error ->
                        binding.tilTaxRate.error = error
                    }
                }

                // Service charge
                launch {
                    viewModel.serviceChargeRate.collect { rate ->
                        if (!binding.etServiceCharge.isFocused) {
                            binding.etServiceCharge.setText(formatRate(rate))
                        }
                    }
                }

                // Service charge error
                launch {
                    viewModel.serviceChargeError.collect { error ->
                        binding.tilServiceCharge.error = error
                    }
                }

                // Favorites count
                launch {
                    viewModel.favoriteItemIds.collect { ids ->
                        binding.tvFavoritesCount.text = "${ids.size}/${AccountSettingsViewModel.MAX_FAVORITES} items selected"
                    }
                }

                // Show favorites dialog
                launch {
                    viewModel.showFavoritesDialog.collect { show ->
                        if (show) {
                            showFavoritesSelectionDialog()
                        }
                    }
                }

                // Errors
                launch {
                    viewModel.error.collect { errorMessage ->
                        Snackbar.make(binding.root, errorMessage, Snackbar.LENGTH_LONG).show()
                    }
                }

                // Messages
                launch {
                    viewModel.message.collect { message ->
                        Snackbar.make(binding.root, message, Snackbar.LENGTH_SHORT).show()
                    }
                }

                // Logout event
                launch {
                    viewModel.logoutEvent.collect {
                        // Navigate to login screen — handled by the hosting Activity
                        activity?.finish()
                    }
                }
            }
        }

        // Set app version
        binding.tvAppVersion.text = "Version ${viewModel.appVersion}"
    }

    private fun showLogoutConfirmation() {
        MaterialAlertDialogBuilder(requireContext())
            .setTitle("Logout")
            .setMessage("Are you sure you want to sign out?")
            .setPositiveButton("Logout") { _, _ ->
                viewModel.logout()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun showFavoritesSelectionDialog() {
        val items = viewModel.availableItems.value
        val currentFavorites = viewModel.favoriteItemIds.value.toMutableSet()

        if (items.isEmpty()) {
            Snackbar.make(binding.root, "No menu items available", Snackbar.LENGTH_SHORT).show()
            viewModel.closeFavoritesSelector()
            return
        }

        val itemNames = items.map { it.name }.toTypedArray()
        val checkedItems = BooleanArray(items.size) { index ->
            currentFavorites.contains(items[index].id)
        }

        MaterialAlertDialogBuilder(requireContext())
            .setTitle("Select Favorites (max ${AccountSettingsViewModel.MAX_FAVORITES})")
            .setMultiChoiceItems(itemNames, checkedItems) { _, which, isChecked ->
                val itemId = items[which].id
                if (isChecked) {
                    if (currentFavorites.size >= AccountSettingsViewModel.MAX_FAVORITES) {
                        checkedItems[which] = false
                        Snackbar.make(
                            binding.root,
                            "Maximum ${AccountSettingsViewModel.MAX_FAVORITES} favorites allowed",
                            Snackbar.LENGTH_SHORT
                        ).show()
                    } else {
                        currentFavorites.add(itemId)
                    }
                } else {
                    currentFavorites.remove(itemId)
                }
            }
            .setPositiveButton("Save") { _, _ ->
                viewModel.saveFavorites(currentFavorites.toList())
            }
            .setNegativeButton("Cancel") { _, _ ->
                viewModel.closeFavoritesSelector()
            }
            .setOnDismissListener {
                viewModel.closeFavoritesSelector()
            }
            .show()
    }

    private fun formatRate(rate: Double): String {
        return if (rate == rate.toLong().toDouble()) {
            rate.toLong().toString()
        } else {
            rate.toString()
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
