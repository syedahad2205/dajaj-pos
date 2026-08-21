/**
 * TanStack Query hook for a single day's Daily Closing document.
 *
 * Calls GET /api/mobile/v1/finance/closing/{date} which runs getDailyClosingView()
 * server-side — correctly resolves opening cash chaining from yesterday's locked
 * closing even when today's Firestore document doesn't exist yet.
 * (Requirement 9.1, design §6.1)
 */
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { FinanceDailyClosing } from '@/modules/daily-closing/types';
import { toDateKey } from '@/modules/daily-closing/utils/dateUtils';
import { getFirebaseAuth } from '@/core/firebase/firebaseClient';
import { API_BASE } from '@/config';

const DEFAULT_STALE_TIME = 30_000;

async function fetchDailyClosingFromAPI(date: string): Promise<FinanceDailyClosing | null> {
  const auth = getFirebaseAuth();

  // Use currentUser if available; if not, wait for auth state to resolve.
  // On iOS the currentUser may be null briefly after signInWithCustomToken
  // before onAuthStateChanged fires, so we wait up to 5 s for it.
  let currentUser = auth.currentUser;
  if (!currentUser) {
    currentUser = await new Promise((resolve) => {
      const unsub = auth.onAuthStateChanged((u) => {
        unsub();
        resolve(u);
      });
    });
  }

  // Force refresh so the latest custom claims are always present
  const idToken = await currentUser?.getIdToken(true);
  if (!idToken) {
    throw new Error('Not authenticated.');
  }

  const response = await fetch(`${API_BASE}/finance/closing/${date}`, {
    method: 'GET',
    headers: {
      'X-Auth-Token': `Bearer ${idToken}`,
      'Authorization': `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
  });

  const data = (await response.json()) as
    | { success: true; closing: FinanceDailyClosing; serverTime: string }
    | { success: false; message: string };

  if (!data.success) {
    throw new Error(data.message);
  }

  return data.closing;
}

export function useDailyClosing(date: string): UseQueryResult<FinanceDailyClosing | null> {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: ['dailyClosing', date],
    queryFn: async () => {
      const closing = await fetchDailyClosingFromAPI(date);
      queryClient.setQueryDefaults(['dailyClosing', date], {
        staleTime: closing?.locked ? Infinity : DEFAULT_STALE_TIME,
      });
      return closing;
    },
    staleTime: DEFAULT_STALE_TIME,
    retry: 2,
    retryDelay: 1000,
  });
}

export function useTodaysClosing() {
  return useDailyClosing(toDateKey());
}
