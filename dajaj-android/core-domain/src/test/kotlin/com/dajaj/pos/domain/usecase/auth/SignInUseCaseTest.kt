package com.dajaj.pos.domain.usecase.auth

import com.dajaj.pos.common.Result
import com.dajaj.pos.domain.model.User
import com.dajaj.pos.domain.model.UserRole
import com.dajaj.pos.domain.model.UserStatus
import com.dajaj.pos.domain.repository.AuthRepository
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class SignInUseCaseTest {

    private lateinit var authRepository: AuthRepository
    private lateinit var signInUseCase: SignInUseCase

    private val testUser = User(
        id = "user_123",
        email = "cashier@dajaj.com",
        name = "Ahmed",
        role = UserRole.CASHIER,
        status = UserStatus.ACTIVE
    )

    @Before
    fun setup() {
        authRepository = mockk()
        signInUseCase = SignInUseCase(authRepository)
    }

    @Test
    fun `invoke with valid credentials returns success`() = runTest {
        coEvery { authRepository.signIn(any(), any()) } returns Result.Success(testUser)

        val result = signInUseCase("cashier@dajaj.com", "password123")

        assertTrue(result.isSuccess)
        assertEquals(testUser, (result as Result.Success).data)
        coVerify { authRepository.signIn("cashier@dajaj.com", "password123") }
    }

    @Test
    fun `invoke with empty email returns error`() = runTest {
        val result = signInUseCase("", "password123")

        assertTrue(result.isError)
        assertEquals("Invalid email format", (result as Result.Error).message)
        coVerify(exactly = 0) { authRepository.signIn(any(), any()) }
    }

    @Test
    fun `invoke with invalid email format returns error`() = runTest {
        val result = signInUseCase("not-an-email", "password123")

        assertTrue(result.isError)
        assertEquals("Invalid email format", (result as Result.Error).message)
        coVerify(exactly = 0) { authRepository.signIn(any(), any()) }
    }

    @Test
    fun `invoke with email missing domain returns error`() = runTest {
        val result = signInUseCase("user@", "password123")

        assertTrue(result.isError)
        assertEquals("Invalid email format", (result as Result.Error).message)
    }

    @Test
    fun `invoke with password shorter than 6 chars returns error`() = runTest {
        val result = signInUseCase("cashier@dajaj.com", "12345")

        assertTrue(result.isError)
        assertEquals("Password must be at least 6 characters", (result as Result.Error).message)
        coVerify(exactly = 0) { authRepository.signIn(any(), any()) }
    }

    @Test
    fun `invoke with password exactly 6 chars calls repository`() = runTest {
        coEvery { authRepository.signIn(any(), any()) } returns Result.Success(testUser)

        val result = signInUseCase("cashier@dajaj.com", "123456")

        assertTrue(result.isSuccess)
        coVerify { authRepository.signIn("cashier@dajaj.com", "123456") }
    }

    @Test
    fun `invoke with empty password returns error`() = runTest {
        val result = signInUseCase("cashier@dajaj.com", "")

        assertTrue(result.isError)
        assertEquals("Password must be at least 6 characters", (result as Result.Error).message)
    }

    @Test
    fun `invoke propagates repository error`() = runTest {
        coEvery { authRepository.signIn(any(), any()) } returns Result.Error("Invalid credentials")

        val result = signInUseCase("cashier@dajaj.com", "password123")

        assertTrue(result.isError)
        assertEquals("Invalid credentials", (result as Result.Error).message)
    }
}
