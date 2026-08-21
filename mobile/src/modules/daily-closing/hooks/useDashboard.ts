/**
 * TanStack Query hook for the finance dashboard summary.
 *
 * Calls GET /api/mobile/v1/finance/dashboard which runs the SAME service as
 * the web dashboard (getFinanceDashboardSummary) — so expenses include bank
 * transactions from the ledger, not just Daily Closing cash entries.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { FinanceDashboardSummary } from '@/modules/daily-closing/types';
import { getFirebaseAuth } from '@/core/firebase/firebaseClient';
import { API_BASE } from '@/config';

const STALE_TIME = 60_000;

async function fetchDashboardFromAPI(): Promise<FinanceDashboardSummary> {
  const auth = getFirebaseAuth();
  let currentUser = auth.currentUser;
  if (!currentUser) {
    currentUser = await new Promise((resolve) => {
      const unsub = auth.onAuthStateChanged((u) => {
        unsub();
        resolve(u);
      });
    });
  }
  const idToken = await currentUser?.getIdToken();
  if (!idToken) throw new Error('Not authenticated.');

  const response = await fetch(`${API_BASE}/finance/dashboard`, {
    method: 'GET',
    headers: {
      // X-Auth-Token duplicates the token: Vercel has been observed stripping
      // the Authorization header; the server accepts either.
      Authorization: `Bearer ${idToken}`,
      'X-Auth-Token': `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
  });

  const rawBody = await response.text();
  let data:
    | { success: true; summary: FinanceDashboardSummary }
    | { success: false; message: string };
  try {
    data = JSON.parse(rawBody);
  } catch {
    throw new Error(
      response.status === 404
        ? 'Server update required — the backend does not have this endpoint yet.'
        : `Server error (${response.status}). Please try again later.`,
    );
  }

  if (!data.success) throw new Error(data.message);
  return data.summary;
}

export function useDashboard(): UseQueryResult<FinanceDashboardSummary> {
  return useQuery({
    queryKey: ['financeDashboard'],
    queryFn: fetchDashboardFromAPI,
    staleTime: STALE_TIME,
    retry: 1,
  });
}
