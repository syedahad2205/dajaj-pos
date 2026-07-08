/**
 * Zustand auth session store (Requirement 1.6, 1.10, design §5).
 *
 * Holds the current FinanceUserPublic and session status.
 * AuthProvider writes to this store via setUser/setStatus.
 * Screens read from it via useAuthStore().
 */
import { create } from 'zustand';
import type { FinanceUserPublic } from '@/modules/daily-closing/types';
import { clearQueue } from '@/core/offline/mutationQueue';

export type SessionStatus = 'pending' | 'authenticated' | 'unauthenticated';

interface AuthState {
  user: FinanceUserPublic | null;
  status: SessionStatus;

  setUser: (user: FinanceUserPublic | null) => void;
  setStatus: (status: SessionStatus) => void;
  /**
   * Full sign-out: clears user, status, and the offline mutation queue
   * (cached drafts). Called by AuthProvider on logout or session invalidation
   * (Requirement 1.11, 2.7).
   */
  signOut: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  status: 'pending',

  setUser(user) {
    set({ user });
  },

  setStatus(status) {
    set({ status });
  },

  signOut() {
    clearQueue(); // Requirement 1.11, 2.7 — clear cached daily closing drafts
    set({ user: null, status: 'unauthenticated' });
  },
}));
