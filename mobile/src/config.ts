/**
 * App-wide configuration constants.
 *
 * BACKEND_URL priority: BACKEND_URL env var → https://dajaj.in (production)
 *
 * LOCAL DEVELOPMENT (emulator/simulator):
 * Set BACKEND_URL via react-native-config .env file:
 *   iOS Simulator:    BACKEND_URL=http://localhost:3000
 *   Android Emulator: BACKEND_URL=http://10.0.2.2:3000
 *
 * FIREBASE CLIENT CONFIG:
 * Public client-side values — not secrets. Same as NEXT_PUBLIC_FIREBASE_* env vars.
 */

// ─── Backend URL ────────────────────────────────────────────────────────────

/**
 * Resolves the backend URL.
 * Production: https://dajaj.in
 * Dev override: set BACKEND_URL env var (via react-native-config .env)
 */
function resolveBackendUrl(): string {
  if (process.env.BACKEND_URL) return process.env.BACKEND_URL;
  return 'https://dajaj.in';
}

export const BACKEND_URL = resolveBackendUrl();
export const API_VERSION = 'v1';
export const API_BASE = `${BACKEND_URL}/api/mobile/${API_VERSION}`;

// ─── Firebase Client Config ─────────────────────────────────────────────────
// Project: dajaj-pos | Region: asia-south1

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCRoSlpfLNi1JFHu5aYc4CLqZo3h2eww00',
  authDomain: 'dajaj-pos.firebaseapp.com',
  projectId: 'dajaj-pos',
  storageBucket: 'dajaj-pos.firebasestorage.app',
  messagingSenderId: '952329776691',
  appId: '1:952329776691:web:48b90f5d72eb13909c7d46',
};
