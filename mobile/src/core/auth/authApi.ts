/**
 * Auth API wrapper — POST /api/mobile/v1/finance/auth/login
 * (Requirement 1.1, design §5.1)
 *
 * No Authorization header — caller has no identity yet, only credentials.
 * Includes deviceTime per Requirement 10.4.
 */
import type { FinanceUserPublic } from '@/modules/daily-closing/types';
import { BACKEND_URL } from '@/config';

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
  const response = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password,
      deviceTime: new Date().toISOString(),
    }),
  });

  const data = (await response.json()) as
    | { success: true; customToken: string; user: FinanceUserPublic }
    | { success: false; message: string };

  if (!data.success) throw new Error(data.message);
  return { customToken: data.customToken, user: data.user };
}
