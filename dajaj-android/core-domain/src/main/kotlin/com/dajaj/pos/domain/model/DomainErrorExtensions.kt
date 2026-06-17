package com.dajaj.pos.domain.model

import com.dajaj.pos.common.Result

/**
 * Extension functions for creating [Result.Error] from [DomainError] instances,
 * bridging the structured error type system with the existing [Result] wrapper.
 */

/**
 * Converts a [DomainError] to a [Result.Error] using the user-friendly message.
 */
fun <T> DomainError.toResult(): Result<T> = Result.Error(
    message = toUserMessage(),
    throwable = if (this is DomainError.Unexpected) cause else null
)

/**
 * Extracts a [DomainError] from a [Result.Error]'s throwable if it was wrapped
 * as a [DomainException], or returns `null` if the error has no structured domain error.
 */
fun Result.Error.domainError(): DomainError? {
    return (throwable as? DomainException)?.domainError
}

/**
 * Wrapper exception that carries a [DomainError] through the standard exception mechanism.
 * Useful for propagating structured errors through APIs that expect [Throwable].
 */
class DomainException(
    val domainError: DomainError
) : Exception(domainError.toUserMessage()) {

    override fun toString(): String = "DomainException(${domainError::class.simpleName})"
}
