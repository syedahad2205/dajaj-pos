package com.dajaj.pos.common

/**
 * A generic wrapper for domain layer results, encapsulating success, error, or loading states.
 */
sealed class Result<out T> {

    /**
     * Represents a successful operation with [data].
     */
    data class Success<out T>(val data: T) : Result<T>()

    /**
     * Represents a failed operation with an error [message] and optional [throwable].
     */
    data class Error(
        val message: String,
        val throwable: Throwable? = null
    ) : Result<Nothing>()

    /**
     * Represents an in-progress operation.
     */
    data object Loading : Result<Nothing>()

    /**
     * Returns `true` if this is a [Success] instance.
     */
    val isSuccess: Boolean get() = this is Success

    /**
     * Returns `true` if this is an [Error] instance.
     */
    val isError: Boolean get() = this is Error

    /**
     * Returns `true` if this is a [Loading] instance.
     */
    val isLoading: Boolean get() = this is Loading

    /**
     * Returns the data if this is [Success], or `null` otherwise.
     */
    fun getOrNull(): T? = when (this) {
        is Success -> data
        else -> null
    }

    /**
     * Maps the success data using [transform], preserving error and loading states.
     */
    fun <R> map(transform: (T) -> R): Result<R> = when (this) {
        is Success -> Success(transform(data))
        is Error -> this
        is Loading -> this
    }
}
