package com.dajaj.pos.feature.settings.device

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dajaj.pos.common.Result
import com.dajaj.pos.domain.repository.DeviceInfo
import com.dajaj.pos.domain.repository.DeviceRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * ViewModel for the Device Management screen.
 *
 * Implements Requirements 10.1, 10.2:
 * - Display this device's name, status, last heartbeat
 * - Allow editing device name (max 50 chars)
 * - Show primary printer designation status
 */
@HiltViewModel
class DeviceManagementViewModel @Inject constructor(
    private val deviceRepository: DeviceRepository
) : ViewModel() {

    companion object {
        const val MAX_DEVICE_NAME_LENGTH = 50
    }

    /**
     * This device's info observable state.
     */
    val myDevice: StateFlow<DeviceInfo?> = deviceRepository.observeMyDevice()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    private val _isEditing = MutableStateFlow(false)
    val isEditing: StateFlow<Boolean> = _isEditing.asStateFlow()

    private val _editingName = MutableStateFlow("")
    val editingName: StateFlow<String> = _editingName.asStateFlow()

    private val _nameError = MutableStateFlow<String?>(null)
    val nameError: StateFlow<String?> = _nameError.asStateFlow()

    private val _error = MutableSharedFlow<String>()
    val error: SharedFlow<String> = _error.asSharedFlow()

    private val _message = MutableSharedFlow<String>()
    val message: SharedFlow<String> = _message.asSharedFlow()

    /**
     * Returns this device's unique identifier.
     */
    fun getDeviceId(): String = deviceRepository.getMyDeviceId()

    /**
     * Starts editing mode for the device name.
     */
    fun startEditing() {
        _editingName.value = myDevice.value?.deviceName ?: ""
        _nameError.value = null
        _isEditing.value = true
    }

    /**
     * Cancels editing mode without saving.
     */
    fun cancelEditing() {
        _isEditing.value = false
        _nameError.value = null
    }

    /**
     * Updates the editing name value and validates it.
     */
    fun onNameChanged(name: String) {
        _editingName.value = name
        _nameError.value = validateDeviceName(name)
    }

    /**
     * Saves the updated device name.
     * Validates: non-empty, max 50 characters.
     */
    fun saveDeviceName() {
        val name = _editingName.value.trim()

        val error = validateDeviceName(name)
        if (error != null) {
            _nameError.value = error
            return
        }

        viewModelScope.launch {
            when (val result = deviceRepository.updateDeviceName(name)) {
                is Result.Success -> {
                    _isEditing.value = false
                    _message.emit("Device name updated")
                }
                is Result.Error -> {
                    _error.emit(result.message)
                }
                is Result.Loading -> { /* no-op */ }
            }
        }
    }

    private fun validateDeviceName(name: String): String? {
        return when {
            name.isBlank() -> "Device name cannot be empty"
            name.length > MAX_DEVICE_NAME_LENGTH -> "Device name must be $MAX_DEVICE_NAME_LENGTH characters or less"
            else -> null
        }
    }

    /**
     * Formats the last heartbeat timestamp as a human-readable relative time string.
     */
    fun formatLastHeartbeat(timestampMillis: Long): String {
        if (timestampMillis == 0L) return "Never"

        val now = System.currentTimeMillis()
        val diffSeconds = (now - timestampMillis) / 1000

        return when {
            diffSeconds < 60 -> "Just now"
            diffSeconds < 3600 -> "${diffSeconds / 60} min ago"
            diffSeconds < 86400 -> "${diffSeconds / 3600} hours ago"
            else -> "${diffSeconds / 86400} days ago"
        }
    }
}
