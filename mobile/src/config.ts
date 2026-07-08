/**
 * App-wide configuration constants.
 *
 * PRODUCTION DEPLOYMENT:
 * Set the BACKEND_URL environment variable to your deployed Next.js URL
 * (e.g. https://dajaj-pos.vercel.app) via your CI/CD pipeline or a
 * react-native-config `.env` file. The fallback values below are for
 * local development only.
 *
 * FIREBASE CLIENT CONFIG:
 * These are public, client-side values — not secrets. They are safe to
 * commit and identical to the web app's NEXT_PUBLIC_FIREBASE_* env vars.
 * They identify the Firebase project but grant no privileged access; all
 * authorization is enforced by Firestore Security Rules and the Admin SDK.
 */
import { Platform } from 'react-native';

// ─── Backend URL ────────────────────────────────────────────────────────────

/**
 * Resolves the backend URL for the current runtime environment.
 * Priority: BACKEND_URL env var > platform-specific dev default.
 *
 * For physical devices on the same WiFi as your dev machine:
 *   Set BACKEND_URL=http://<your-mac-lan-ip>:3000 in mobile/.env
 *   (or update DEV_DEVICE_IP below if not using react-native-config).
 */
function resolveBackendUrl(): string {
  // Production / CI — always wins
  if (process.env.BACKEND_URL) return process.env.BACKEND_URL;

  // iOS Simulator shares the Mac's localhost network stack directly
  if (Platform.OS === 'ios') return 'http://localhost:3000';

  // Android Emulator: 10.0.2.2 is the standard alias for the host machine
  return 'http://10.0.2.2:3000';
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
