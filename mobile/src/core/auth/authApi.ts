/**
 * Auth API wrapper — POST /api/mobile/v1/finance/auth/login
 * (Requirement 1.1, design §5.1)
 *
 * No Authorization header — caller has no identity yet, only credentials.
 * Includes deviceTime per Requirement 10.4.
 *
 * All auth flow steps are logged through the centralized logger.
 * Passwords are never logged.
 */
import type { FinanceUserPublic } from '@/modules/daily-closing/types';
import { BACKEND_URL } from '@/config';
import { logger, nextRequestId, sanitizeHeaders } from '@/core/logging/logger';

const LOGIN_URL = `${BACKEND_URL}/api/mobile/v1/finance/auth/login`;

export interface LoginResult {
  customToken: string;
  user: FinanceUserPublic;
}

/**
 * Calls the login API route.
 * Throws with the server's exact error message on failure (Requirement 1.3).
 */
export async function login(username: string, password: string): Promise<LoginResult> {
  const requestId = nextRequestId();
  const headers = { 'Content-Type': 'application/json' };

  // Log request — password is intentionally omitted from the log body
  logger.network.request(requestId, 'POST', LOGIN_URL, headers, { username, password: '[REDACTED]', deviceTime: '(set at send)' });
  logger.auth.loginStart(username);

  const startMs = Date.now();

  let response: Response;
  try {
    response = await fetch(LOGIN_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        username,
        password,
        deviceTime: new Date().toISOString(),
      }),
    });
  } catch (error) {
    logger.network.failure(requestId, error);
    logger.auth.loginFailure(username, error instanceof Error ? error.message : String(error));
    throw error;
  }

  const durationMs = Date.now() - startMs;

  const data = (await response.json()) as
    | { success: true; customToken: string; user: FinanceUserPublic }
    | { success: false; message: string };

  // Log response — customToken value is masked automatically by sanitize()
  logger.network.response(requestId, response.status, response.statusText, durationMs, data);

  if (!data.success) {
    logger.auth.loginFailure(username, data.message);
    throw new Error(data.message);
  }

  logger.auth.customTokenReceived();
  return { customToken: data.customToken, user: data.user };
}
