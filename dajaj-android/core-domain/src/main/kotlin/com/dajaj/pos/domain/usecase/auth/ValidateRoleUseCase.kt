package com.dajaj.pos.domain.usecase.auth

import com.dajaj.pos.common.Result
import com.dajaj.pos.domain.model.User
import com.dajaj.pos.domain.model.UserRole
import com.dajaj.pos.domain.model.UserStatus
import javax.inject.Inject

/**
 * Use case that validates whether a user has an active POS staff role.
 * A user is considered valid POS staff if they have a CASHIER, MANAGER, or ADMIN role
 * AND their account status is ACTIVE.
 */
class ValidateRoleUseCase @Inject constructor() {

    operator fun invoke(user: User): Result<Boolean> {
        val hasStaffRole = user.role in ALLOWED_POS_ROLES
        val isActive = user.status == UserStatus.ACTIVE

        return Result.Success(hasStaffRole && isActive)
    }

    companion object {
        val ALLOWED_POS_ROLES = setOf(UserRole.CASHIER, UserRole.MANAGER, UserRole.ADMIN)
    }
}
