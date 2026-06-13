package com.dajaj.pos.domain.usecase.auth

import com.dajaj.pos.common.Result
import com.dajaj.pos.domain.model.User
import com.dajaj.pos.domain.model.UserRole
import com.dajaj.pos.domain.model.UserStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class ValidateRoleUseCaseTest {

    private lateinit var validateRoleUseCase: ValidateRoleUseCase

    @Before
    fun setup() {
        validateRoleUseCase = ValidateRoleUseCase()
    }

    @Test
    fun `active cashier returns true`() {
        val user = createUser(role = UserRole.CASHIER, status = UserStatus.ACTIVE)

        val result = validateRoleUseCase(user)

        assertTrue(result.isSuccess)
        assertEquals(true, (result as Result.Success).data)
    }

    @Test
    fun `active manager returns true`() {
        val user = createUser(role = UserRole.MANAGER, status = UserStatus.ACTIVE)

        val result = validateRoleUseCase(user)

        assertTrue(result.isSuccess)
        assertEquals(true, (result as Result.Success).data)
    }

    @Test
    fun `active admin returns true`() {
        val user = createUser(role = UserRole.ADMIN, status = UserStatus.ACTIVE)

        val result = validateRoleUseCase(user)

        assertTrue(result.isSuccess)
        assertEquals(true, (result as Result.Success).data)
    }

    @Test
    fun `active customer returns false`() {
        val user = createUser(role = UserRole.CUSTOMER, status = UserStatus.ACTIVE)

        val result = validateRoleUseCase(user)

        assertTrue(result.isSuccess)
        assertEquals(false, (result as Result.Success).data)
    }

    @Test
    fun `pending cashier returns false`() {
        val user = createUser(role = UserRole.CASHIER, status = UserStatus.PENDING)

        val result = validateRoleUseCase(user)

        assertTrue(result.isSuccess)
        assertEquals(false, (result as Result.Success).data)
    }

    @Test
    fun `rejected manager returns false`() {
        val user = createUser(role = UserRole.MANAGER, status = UserStatus.REJECTED)

        val result = validateRoleUseCase(user)

        assertTrue(result.isSuccess)
        assertEquals(false, (result as Result.Success).data)
    }

    @Test
    fun `pending customer returns false`() {
        val user = createUser(role = UserRole.CUSTOMER, status = UserStatus.PENDING)

        val result = validateRoleUseCase(user)

        assertTrue(result.isSuccess)
        assertEquals(false, (result as Result.Success).data)
    }

    private fun createUser(
        role: UserRole,
        status: UserStatus
    ) = User(
        id = "user_test",
        email = "test@dajaj.com",
        name = "Test User",
        role = role,
        status = status
    )
}
