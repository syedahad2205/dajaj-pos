/**
 * Firebase JS SDK initialisation for the React Native app.
 *
 * Auth uses AsyncStorage-backed persistence via getReactNativePersistence —
 * the official Firebase RN approach, compatible with Hermes.
 *
 * Config is centralized in src/config.ts.
 * All initialization and auth state events are logged via the centralized logger.
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
import { logger } from '@/core/logging/logger';

let app: FirebaseApp | undefined;
let _auth: ReturnType<typeof initializeAuth> | undefined;
let _firestore: Firestore | undefined;

function getApp(): FirebaseApp {
  if (!app) {
    app = initializeApp(FIREBASE_CONFIG);
    logger.firebase.initialized(FIREBASE_CONFIG.projectId);
  }
  return app;
}

/** Firebase Auth with AsyncStorage-backed persistence (Requirement 1.9). */
export function getFirebaseAuth(): ReturnType<typeof initializeAuth> {
  if (!_auth) {
    _auth = initializeAuth(getApp(), {
      persistence: getReactNativePersistence(AsyncStorage),
    });
    logger.debug('firebase', 'Firebase Auth initialized with AsyncStorage persistence');
  }
  return _auth;
}

/** Shared Firestore client instance. */
export function getFirebaseFirestore(): Firestore {
  if (!_firestore) {
    _firestore = getFirestore(getApp());
    logger.debug('firebase', 'Firestore client initialized');
  }
  return _firestore;
}
