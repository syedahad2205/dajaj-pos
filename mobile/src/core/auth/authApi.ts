/**
 * Auth API wrapper — GET /api/mobile/v1/finance/auth/whoami
 *
 * Firebase Authentication handles sign-in directly on the device
 * (signInWithEmailAndPassword). This call answers authorization:
 * which finance role the signed-in account holds (admin | financeManager)
 * and what display name to show. Called right after sign-in and on session
 * restore.
 *
 * No special headers beyond the caller's fresh ID token.
 * All flow steps are logged through the centralized logger.
 */
import type { MobileIdentity } from '@/modules/daily-closing/types';
import { API_BASE } from '@/config';
import { logger, nextRequestId } from '@/core/logging/logger';

export type WhoamiResult = MobileIdentity;

/**
 * Resolves the signed-in user's finance identity.
 * Throws with the server's message when the account has no finance access.
 */
export async function whoami(idToken: string): Promise<WhoamiResult> {
  const requestId = nextRequestId();
  const url = `${API_BASE}/finance/auth/whoami`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${idToken}`,
  };

  logger.network.request(requestId, 'GET', url, headers, undefined);

  const startMs = Date.now();

  let response: Response;
  try {
    response = await fetch(url, { method: 'GET', headers });
  } catch (error) {
    logger.network.failure(requestId, error);
    throw error;
  }

  const durationMs = Date.now() - startMs;

  // Guard against non-JSON responses (e.g. HTML 404 pages when the deployed
  // backend predates this route) — surface an actionable message instead of
  // a cryptic "Unexpected character" parse error.
  const rawBody = await response.text();
  let data:
    | { success: true; uid: string; role: 'admin' | 'financeManager'; fullName: string; email: string | null }
    | { success: false; message: string };
  try {
    data = JSON.parse(rawBody);
  } catch {
    logger.network.response(requestId, response.status, response.statusText, durationMs, {
      success: false,
      nonJsonBody: rawBody.slice(0, 200),
    });
    throw new Error(
      response.status === 404
        ? 'Server update required — the backend does not have this endpoint yet.'
        : `Server error (${response.status}). Please try again later.`,
    );
  }

  logger.network.response(requestId, response.status, response.statusText, durationMs, {
    success: data.success,
  });

  if (!data.success) {
    throw new Error(data.message);
  }

  return {
    uid: data.uid,
    role: data.role,
    fullName: data.fullName,
    email: data.email,
  };
}
