/**
 * Firebase JS SDK initialisation for the React Native app.
 *
 * Auth uses AsyncStorage-backed persistence via getReactNativePersistence —
 * the official Firebase RN approach, compatible with Hermes.
 *
 * Config is centralized in src/config.ts.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { initializeAuth, getReactNativePersistence } = require('@firebase/auth/dist/rn/index.js') as {
  initializeAuth: typeof import('firebase/auth').initializeAuth;
  getReactNativePersistence: (storage: unknown) => import('firebase/auth').Persistence;
};
import { getFirestore, type Firestore } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FIREBASE_CONFIG } from '@/config';

let app: FirebaseApp | undefined;
let _auth: ReturnType<typeof initializeAuth> | undefined;
let _firestore: Firestore | undefined;

function getApp(): FirebaseApp {
  if (!app) app = initializeApp(FIREBASE_CONFIG);
  return app;
}

/** Firebase Auth with AsyncStorage-backed persistence (Requirement 1.9). */
export function getFirebaseAuth(): ReturnType<typeof initializeAuth> {
  if (!_auth) {
    _auth = initializeAuth(getApp(), {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  }
  return _auth;
}

/** Shared Firestore client instance. */
export function getFirebaseFirestore(): Firestore {
  if (!_firestore) _firestore = getFirestore(getApp());
  return _firestore;
}
