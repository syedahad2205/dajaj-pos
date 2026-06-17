package com.dajaj.pos.feature.settings.device

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.widget.doAfterTextChanged
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.dajaj.pos.domain.repository.DeviceStatus
import com.dajaj.pos.feature.settings.databinding.FragmentDeviceManagementBinding
import com.google.android.material.snackbar.Snackbar
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch

/**
 * Fragment for Device Management settings.
 *
 * Implements Requirements 10.1, 10.2:
 * - Display this device's name, status, last heartbeat
 * - Allow editing device name (max 50 chars)
 * - Show primary printer designation status
 */
@AndroidEntryPoint
class DeviceManagementFragment : Fragment() {

    private var _binding: FragmentDeviceManagementBinding? = null
    private val binding get() = _binding!!

    private val viewModel: DeviceManagementViewModel by viewModels()

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentDeviceManagementBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        setupListeners()
        observeViewModel()
    }

    private fun setupListeners() {
        binding.btnEditName.setOnClickListener {
            viewModel.startEditing()
        }

        binding.btnSaveName.setOnClickListener {
            viewModel.saveDeviceName()
        }

        binding.btnCancelEdit.setOnClickListener {
            viewModel.cancelEditing()
        }

        binding.etDeviceName.doAfterTextChanged { text ->
            viewModel.onNameChanged(text?.toString() ?: "")
        }
    }

    private fun observeViewModel() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                // Observe device info
                launch {
                    viewModel.myDevice.collect { device ->
                        if (device != null) {
                            binding.tvDeviceName.text = device.deviceName
                            binding.tvDeviceId.text = device.id

                            // Status with color indicator
                            val statusText = when (device.status) {
                                DeviceStatus.ONLINE -> "Online"
                                DeviceStatus.OFFLINE -> "Offline"
                            }
                            binding.tvDeviceStatus.text = statusText

                            // Last heartbeat
                            binding.tvLastHeartbeat.text = viewModel.formatLastHeartbeat(device.lastHeartbeat)

                            // Primary printer designation
                            binding.tvPrimaryPrinter.text = if (device.isPrimaryPrinter) {
                                "Yes — This device is the primary print node"
                            } else {
                                "No"
                            }

                            binding.layoutDeviceInfo.visibility = View.VISIBLE
                            binding.layoutNoDevice.visibility = View.GONE
                        } else {
                            binding.layoutDeviceInfo.visibility = View.GONE
                            binding.layoutNoDevice.visibility = View.VISIBLE
                        }
                    }
                }

                // Observe editing state
                launch {
                    viewModel.isEditing.collect { isEditing ->
                        binding.layoutDisplayName.visibility = if (isEditing) View.GONE else View.VISIBLE
                        binding.layoutEditName.visibility = if (isEditing) View.VISIBLE else View.GONE

                        if (isEditing) {
                            binding.etDeviceName.setText(viewModel.editingName.value)
                            binding.etDeviceName.requestFocus()
                        }
                    }
                }

                // Observe name validation errors
                launch {
                    viewModel.nameError.collect { error ->
                        binding.tilDeviceName.error = error
                    }
                }

                // Observe errors
                launch {
                    viewModel.error.collect { errorMessage ->
                        Snackbar.make(binding.root, errorMessage, Snackbar.LENGTH_LONG).show()
                    }
                }

                // Observe success messages
                launch {
                    viewModel.message.collect { message ->
                        Snackbar.make(binding.root, message, Snackbar.LENGTH_SHORT).show()
                    }
                }
            }
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
