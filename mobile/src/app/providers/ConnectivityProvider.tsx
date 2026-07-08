/**
 * ConnectivityProvider — subscribes to NetInfo and AppState once at root level,
 * wiring both into QueueProcessor.runAll() (design §8.1, Requirement 11.1, 11.8, 11.9).
 *
 * Three trigger points for sync:
 *   1. NetInfo online-transition (within 5s via the subscription callback)
 *   2. Manual "Sync Now" (consumers call runAll() directly)
 *   3. AppState → "active" (foreground return)
 *
 * All connectivity changes and sync triggers are logged via the centralized logger.
 */
import React, { useEffect, useRef, type ReactNode } from 'react';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { AppState, type AppStateStatus } from 'react-native';
import { useConnectivityStore } from '@/core/connectivity/useConnectivityStore';
import { runAll } from '@/core/offline/QueueProcessor';
import { useAuthStore } from '@/core/auth/useAuthStore';
import { logger } from '@/core/logging/logger';

interface Props {
  children: ReactNode;
}

export function ConnectivityProvider({ children }: Props) {
  const { setConnectivity } = useConnectivityStore();
  const { status } = useAuthStore();
  const prevAppState = useRef<AppStateStatus>('active');
  const syncTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Only trigger sync when the user is authenticated — avoids calling
  // getFirebaseAuth() before AuthProvider has initialised the SDK.
  function triggerSync(trigger: 'netinfo' | 'foreground' | 'manual') {
    if (status !== 'authenticated') return;
    logger.connectivity.syncTriggered(trigger);
    void runAll();
  }

  useEffect(() => {
    // ── NetInfo subscription ─────────────────────────────────────────
    const unsubNetInfo = NetInfo.addEventListener((state: NetInfoState) => {
      const isOnline = state.isConnected === true && state.isInternetReachable !== false;
      const slowNetwork =
        state.type === 'cellular' &&
        (state.details?.cellularGeneration === '2g' || state.details?.cellularGeneration === null);

      logger.connectivity.changed(isOnline, slowNetwork);
      setConnectivity(isOnline, slowNetwork);

      if (isOnline) {
        // Slight delay so the connection stabilises before hammering the API (Requirement 11.1 "within 5s")
        if (syncTimeout.current) clearTimeout(syncTimeout.current);
        syncTimeout.current = setTimeout(() => {
          triggerSync('netinfo');
        }, 1500);
      }
    });

    // ── AppState subscription ────────────────────────────────────────
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (
        nextState === 'active' &&
        (prevAppState.current === 'background' || prevAppState.current === 'inactive')
      ) {
        logger.debug('app', 'App foregrounded — triggering sync');
        triggerSync('foreground'); // Requirement 11.9
      }
      prevAppState.current = nextState;
    });

    return () => {
      unsubNetInfo();
      subscription.remove();
      if (syncTimeout.current) clearTimeout(syncTimeout.current);
    };
  }, [setConnectivity]);

  return <>{children}</>;
}
