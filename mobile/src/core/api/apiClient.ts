/**
 * Shared fetch wrapper for all mobile mutation API routes
 * (design §6.2, §2a, Requirement 10.4).
 *
 * Attaches Authorization header + deviceTime, parses the response envelope,
 * targets the versioned /api/mobile/v1/... prefix from a single constant.
 *
 * All outgoing requests and responses are logged through the centralized
 * logger — no additional logging needed in individual hooks or screens.
 */
import type { FinanceDailyClosing } from '@/modules/daily-closing/types';
import { API_BASE, API_VERSION } from '@/config';
import { logger, nextRequestId } from '@/core/logging/logger';
import { useConnectivityStore } from '@/core/connectivity/useConnectivityStore';
import { useAuthStore } from '@/core/auth/useAuthStore';

export { API_BASE, API_VERSION };

export interface MutationSuccessResponse {
  success: true;
  closing: FinanceDailyClosing;
  serverTime: string;
}

export interface MutationErrorResponse {
  success: false;
  message: string;
}

export type MutationResponse = MutationSuccessResponse | MutationErrorResponse;

export interface ApiCallOptions {
  method: 'POST' | 'PATCH' | 'DELETE' | 'GET';
  path: string;
  body?: object;
  idToken: string;
  idempotencyKey?: string;
}

export async function apiCall(options: ApiCallOptions): Promise<MutationResponse> {
  const { method, path, body, idToken, idempotencyKey } = options;

  const payload: Record<string, unknown> = {
    ...body,
    deviceTime: new Date().toISOString(),
  };
  if (idempotencyKey) payload.idempotencyKey = idempotencyKey;

  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${idToken}`,
  };
  const requestId = nextRequestId();

  // Log outgoing request — sensitive headers are auto-masked by logger
  logger.network.request(requestId, method, url, headers, payload, {
    username: useAuthStore.getState().user?.username,
    isOnline: useConnectivityStore.getState().isOnline,
  });

  const startMs = Date.now();

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: method !== 'GET' ? JSON.stringify(payload) : undefined,
    });

    const durationMs = Date.now() - startMs;
    const data = (await response.json()) as MutationResponse;

    // Log response — body is sanitized by logger
    logger.network.response(requestId, response.status, response.statusText, durationMs, data);

    return data;
  } catch (error) {
    // Log network-level failure (no response received)
    logger.network.failure(requestId, error, payload);
    throw error;
  }
}
