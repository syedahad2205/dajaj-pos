/**
 * Shared fetch wrapper for all mobile mutation API routes
 * (design §6.2, §2a, Requirement 10.4).
 *
 * Attaches Authorization header + deviceTime, parses the response envelope,
 * targets the versioned /api/mobile/v1/... prefix from a single constant.
 */
import type { FinanceDailyClosing } from '@/modules/daily-closing/types';
import { API_BASE, API_VERSION } from '@/config';

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

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: method !== 'GET' ? JSON.stringify(payload) : undefined,
  });

  return (await response.json()) as MutationResponse;
}
