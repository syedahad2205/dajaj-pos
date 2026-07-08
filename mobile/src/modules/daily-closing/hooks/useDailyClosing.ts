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
  console.log('[fetchDailyClosing] Starting fetch for date:', date);
  console.log('[fetchDailyClosing] Initial currentUser:', auth.currentUser?.uid || 'null');
  
  // Use currentUser if available; if not, wait for auth state to resolve.
  // On iOS the currentUser may be null briefly after signInWithCustomToken
  // before onAuthStateChanged fires, so we wait up to 5 s for it.
  let currentUser = auth.currentUser;
  if (!currentUser) {
    console.log('[fetchDailyClosing] Waiting for auth state...');
    currentUser = await new Promise((resolve) => {
      const unsub = auth.onAuthStateChanged((u) => {
        unsub();
        console.log('[fetchDailyClosing] Auth state resolved:', u?.uid || 'null');
        resolve(u);
      });
    });
  }
  
  console.log('[fetchDailyClosing] Getting ID token for user:', currentUser?.uid);
  
  // FORCE token refresh to ensure custom claims are present
  console.log('[fetchDailyClosing] Forcing token refresh to get latest claims...');
  const idToken = await currentUser?.getIdToken(true); // true = force refresh
  if (!idToken) {
    console.error('[fetchDailyClosing] No ID token - user not authenticated');
    throw new Error('Not authenticated.');
  }
  
  console.log('[fetchDailyClosing] ID token obtained (after refresh), length:', idToken.length);
  console.log('[fetchDailyClosing] Token preview:', idToken.substring(0, 50) + '...');
  
  // Decode the token payload to check claims (for debugging)
  try {
    const tokenParts = idToken.split('.');
    if (tokenParts.length === 3) {
      const payload = JSON.parse(atob(tokenParts[1]));
      console.log('[fetchDailyClosing] Token claims:', JSON.stringify({
        financeUser: payload.financeUser,
        active: payload.active,
        exp: payload.exp,
        iat: payload.iat,
        uid: payload.user_id || payload.sub,
      }));
    }
  } catch (e) {
    console.warn('[fetchDailyClosing] Could not decode token:', e);
  }
  
  const url = `${API_BASE}/finance/closing/${date}`;
  console.log('[fetchDailyClosing] Fetching:', url);
  console.log('[fetchDailyClosing] Full Authorization header:', `Bearer ${idToken.substring(0, 20)}...`);
  
  const headers = { 
    'Authorization': `Bearer ${idToken}`,
    'Content-Type': 'application/json',
  };
  console.log('[fetchDailyClosing] Request headers:', JSON.stringify(Object.keys(headers)));
  console.log('[fetchDailyClosing] Authorization header key:', 'Authorization');
  console.log('[fetchDailyClosing] Authorization header value length:', headers.Authorization.length);

  const response = await fetch(url, {
    method: 'GET',
    headers,
  });

  console.log('[fetchDailyClosing] Response status:', response.status);
  console.log('[fetchDailyClosing] Response ok:', response.ok);

  const data = (await response.json()) as
    | { success: true; closing: FinanceDailyClosing; serverTime: string }
    | { success: false; message: string };

  console.log('[fetchDailyClosing] Response data:', JSON.stringify(data).substring(0, 200));

  if (!data.success) {
    console.error('[fetchDailyClosing] Request failed:', data.message);
    throw new Error(data.message);
  }
  
  console.log('[fetchDailyClosing] Success!');
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
