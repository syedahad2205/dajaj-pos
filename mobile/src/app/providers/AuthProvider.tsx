/**
 * AuthProvider — subscribes to Firebase Auth state once on mount (design §5.3).
 *
 * Responsibilities:
 * - Calls onAuthStateChanged to restore persisted sessions (Requirement 1.10)
 * - Sets useAuthStore user + status on auth state changes
 * - Globally intercepts permission-denied / token-revoked errors to trigger
 *   the forced sign-out flow (Requirement 2.5, 2.7)
 *
 * All auth lifecycle events are logged through the centralized logger.
 */
import React, { useEffect, type ReactNode } from 'react';
import { signOut as firebaseSignOut, onAuthStateChanged } from 'firebase/auth';
import type { NavigationContainerRef } from '@react-navigation/native';
import { getFirebaseAuth } from '@/core/firebase/firebaseClient';
import { useAuthStore } from '@/core/auth/useAuthStore';
import { logger } from '@/core/logging/logger';

// Navigation ref is set by RootNavigator and used here for programmatic navigation
export let navigationRef: NavigationContainerRef<Record<string, unknown>> | null = null;
export function setNavigationRef(ref: NavigationContainerRef<Record<string, unknown>> | null) {
  navigationRef = ref;
}

interface Props {
  children: ReactNode;
}

/**
 * Forcibly sign out when a session is invalidated server-side
 * (Requirement 2.5, 2.7 — disable/password-change by admin).
 */
async function handleSessionInvalidated(message?: string) {
  logger.auth.sessionInvalidated(message ?? 'Session no longer valid');
  const auth = getFirebaseAuth();
  await firebaseSignOut(auth).catch(() => {});
  useAuthStore.getState().signOut();
  if (navigationRef?.isReady()) {
    navigationRef.reset({
      index: 0,
      routes: [
        {
          name: 'Auth',
          state: {
            routes: [
              {
                name: 'Login',
                params: {
                  sessionExpiredMessage:
                    message ?? 'Your session is no longer valid. Please log in again.',
                },
              },
            ],
          },
        },
      ],
    });
  }
}

export function AuthProvider({ children }: Props) {
  const { setUser, setStatus, signOut } = useAuthStore();

  useEffect(() => {
    const auth = getFirebaseAuth();

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        logger.firebase.authStateChanged('signed-in', firebaseUser.uid);
        // Session exists — check if this is a restore vs a fresh login.
        // On fresh login the store already has the user (set by LoginScreen).
        const alreadyHasUser = !!useAuthStore.getState().user;
        if (!alreadyHasUser) {
          logger.auth.sessionRestored(firebaseUser.uid);
        }
        setStatus('authenticated');
      } else {
        logger.firebase.authStateChanged('signed-out');
        setUser(null);
        setStatus('unauthenticated');
      }
    });

    return unsubscribe;
  }, [setUser, setStatus]);

  // Expose the forced-sign-out handler globally for use in error interceptors
  useEffect(() => {
    globalThis.__handleSessionInvalidated = handleSessionInvalidated;
  }, []);

  return <>{children}</>;
}

// Type augmentation for the global helper
declare global {
  // eslint-disable-next-line no-var
  var __handleSessionInvalidated: ((message?: string) => Promise<void>) | undefined;
}
