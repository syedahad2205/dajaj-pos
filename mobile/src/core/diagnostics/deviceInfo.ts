/**
 * Device and app diagnostics helpers (Requirement 14.1, design §10.6).
 * No sensitive data — only public build metadata and queue stats.
 */
import { MMKV } from 'react-native-mmkv';
import { API_VERSION } from '@/core/api/apiClient';

const storage = new MMKV({ id: 'dajaj-finance-diagnostics' });
const LAST_SYNC_KEY = 'last_successful_sync';
const DEVICE_ID_KEY = 'device_id';

export const APP_VERSION = '0.1.0';
export const BUILD_NUMBER = '1';
export const ENVIRONMENT = (process.env.APP_ENV ?? 'development') as 'development' | 'staging' | 'production';
export const FIREBASE_PROJECT = process.env.FIREBASE_PROJECT_ID ?? '(not configured)';
export { API_VERSION };

/**
 * Stable device identifier — generated once on first run, persisted in MMKV.
 * NOT a hardware identifier; intentionally opaque. Used only for offline queue
 * diagnostics (Requirement 10.3), never for analytics or tracking.
 */
export function getDeviceId(): string {
  const existing = storage.getString(DEVICE_ID_KEY);
  if (existing) return existing;
  // Generate a random ID — Math.random is sufficient for local diagnostics (not security-sensitive)
  const id = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  storage.set(DEVICE_ID_KEY, id);
  return id;
}

export function getLastSuccessfulSync(): string | null {
  return storage.getString(LAST_SYNC_KEY) ?? null;
}

export function recordSuccessfulSync(): void {
  storage.set(LAST_SYNC_KEY, new Date().toISOString());
}
