package com.dajaj.pos.feature.settings

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import com.dajaj.pos.feature.settings.account.AccountSettingsFragment
import com.dajaj.pos.feature.settings.databinding.FragmentSettingsBinding
import com.dajaj.pos.feature.settings.device.DeviceManagementFragment
import com.dajaj.pos.feature.settings.printer.PrinterSettingsFragment
import com.google.android.material.tabs.TabLayoutMediator
import dagger.hilt.android.AndroidEntryPoint

/**
 * Main Settings screen with tabbed sections for:
 * - Printer Settings (Requirements 6.1, 6.4, 6.10, 17.1)
 * - Device Management (Requirements 10.1, 10.2)
 * - Account & General (Requirements 16.6, 16.8, 5.4)
 */
@AndroidEntryPoint
class SettingsFragment : Fragment() {

    private var _binding: FragmentSettingsBinding? = null
    private val binding get() = _binding!!

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentSettingsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        setupViewPager()
    }

    private fun setupViewPager() {
        val adapter = SettingsPagerAdapter(this)
        binding.viewPager.adapter = adapter

        TabLayoutMediator(binding.tabLayout, binding.viewPager) { tab, position ->
            tab.text = when (position) {
                0 -> "Printers"
                1 -> "Device"
                2 -> "Account"
                else -> ""
            }
            tab.contentDescription = when (position) {
                0 -> "Printer settings tab"
                1 -> "Device management tab"
                2 -> "Account and general settings tab"
                else -> ""
            }
        }.attach()
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
