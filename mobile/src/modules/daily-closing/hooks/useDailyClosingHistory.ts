/**
 * TanStack Query hook for a date-range list of Daily Closings.
 *
 * Calls GET /api/mobile/v1/finance/history which returns closings augmented
 * with blended expense figures (cash + non-cash ledger transactions) — the
 * same Revenue vs Expense semantics as the web dashboard. Reading through
 * the API (instead of Firestore directly) keeps that business logic
 * server-side so mobile can never drift from web.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { FinanceDailyClosing } from '@/modules/daily-closing/types';
import { getFirebaseAuth } from '@/core/firebase/firebaseClient';
import { API_BASE } from '@/config';

export interface FinanceHistoryDay extends FinanceDailyClosing {
  /** Ledger expense transactions for this day (bank etc.), excluding cash-drawer + Daily Closing auto-posts. */
  bankExpense: number;
  /** cashExpenseTotal + bankExpense — matches the web dashboard. */
  totalExpense: number;
}

const STALE_TIME = 60_000; // 1 min — history doesn't need to be as fresh as today's doc

async function fetchHistoryFromAPI(dateFrom: string, dateTo: string): Promise<FinanceHistoryDay[]> {
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

  const url = `${API_BASE}/finance/history?dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`;
  const response = await fetch(url, {
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
  let data: { success: true; closings: FinanceHistoryDay[] } | { success: false; message: string };
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
  return data.closings;
}

export function useDailyClosingHistory(
  dateFrom: string,
  dateTo: string,
): UseQueryResult<FinanceHistoryDay[]> {
  return useQuery({
    queryKey: ['dailyClosingHistory', dateFrom, dateTo],
    queryFn: () => fetchHistoryFromAPI(dateFrom, dateTo),
    staleTime: STALE_TIME,
    retry: 1,
  });
}
