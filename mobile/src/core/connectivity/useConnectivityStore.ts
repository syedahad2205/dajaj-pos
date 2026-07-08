/**
 * Zustand connectivity + sync-status store (design §8, Requirement 13.1–13.4).
 *
 * Exposes four distinct states — never merged (Requirement 13.2):
 *   synced       — online, queue empty for the relevant scope
 *   pending-sync — online, queue has pending/syncing items, none failed
 *   offline      — NetInfo reports no connectivity (takes precedence over pending-sync)
 *   sync-failed  — online, queue has failed items (takes precedence over pending-sync)
 *
 * A secondary advisory "slowNetwork" flag is set when NetInfo reports connectivity
 * but with a slow effective type (2g/cellular) — UI can use this to show a warning.
 */
import { create } from 'zustand';

export type SyncStatus = 'synced' | 'pending-sync' | 'offline' | 'sync-failed';

interface ConnectivityState {
  isOnline: boolean;
  slowNetwork: boolean;
  syncStatus: SyncStatus;

  /** Call when NetInfo reports a connectivity change. */
  setConnectivity: (isOnline: boolean, slowNetwork?: boolean) => void;
  /** Call after queue state changes to recompute syncStatus. */
  recomputeSyncStatus: (hasPending: boolean, hasFailed: boolean) => void;
  /** Manually set sync status (used by QueueProcessor during replay). */
  setSyncStatus: (status: SyncStatus) => void;
}

export const useConnectivityStore = create<ConnectivityState>()((set, get) => ({
  isOnline: true,
  slowNetwork: false,
  syncStatus: 'synced',

  setConnectivity(isOnline, slowNetwork = false) {
    set({ isOnline, slowNetwork });
    // Offline always takes precedence (Requirement 13.2)
    if (!isOnline) {
      set({ syncStatus: 'offline' });
      return;
    }
    // Re-derive from current queue state
    const current = get();
    // If we just came online, leave recompute to QueueProcessor result
    set(state => ({
      syncStatus: state.syncStatus === 'offline'
        ? 'pending-sync' // will settle once QueueProcessor runs
        : state.syncStatus,
    }));
  },

  recomputeSyncStatus(hasPending, hasFailed) {
    const { isOnline } = get();
    if (!isOnline) {
      set({ syncStatus: 'offline' });
      return;
    }
    // Precedence: sync-failed > pending-sync > synced
    if (hasFailed) {
      set({ syncStatus: 'sync-failed' });
    } else if (hasPending) {
      set({ syncStatus: 'pending-sync' });
    } else {
      set({ syncStatus: 'synced' });
    }
  },

  setSyncStatus(status) {
    set({ syncStatus: status });
  },
}));
