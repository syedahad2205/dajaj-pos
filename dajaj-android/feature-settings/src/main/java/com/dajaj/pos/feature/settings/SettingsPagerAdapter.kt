package com.dajaj.pos.feature.settings

import androidx.fragment.app.Fragment
import androidx.viewpager2.adapter.FragmentStateAdapter
import com.dajaj.pos.feature.settings.account.AccountSettingsFragment
import com.dajaj.pos.feature.settings.device.DeviceManagementFragment
import com.dajaj.pos.feature.settings.printer.PrinterSettingsFragment

/**
 * ViewPager2 adapter for the Settings screen tabs.
 * Provides fragments for Printers, Device, and Account sections.
 */
class SettingsPagerAdapter(
    fragment: Fragment
) : FragmentStateAdapter(fragment) {

    override fun getItemCount(): Int = 3

    override fun createFragment(position: Int): Fragment {
        return when (position) {
            0 -> PrinterSettingsFragment()
            1 -> DeviceManagementFragment()
            2 -> AccountSettingsFragment()
            else -> throw IllegalArgumentException("Invalid settings tab position: $position")
        }
    }
}
