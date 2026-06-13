package com.dajaj.pos.ui.main.pendingorders

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import com.dajaj.pos.databinding.FragmentPendingOrdersBinding
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class PendingOrdersFragment : Fragment() {

    private var _binding: FragmentPendingOrdersBinding? = null
    private val binding get() = _binding!!

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentPendingOrdersBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
