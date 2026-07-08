/**
 * TanStack Query hook for a date-range list of Daily Closings (design §6.1, Requirement 9.6).
 *
 * Query shape: branchId == DEFAULT_BRANCH_ID, date >= from, date <= to, orderBy date desc
 * This matches the composite index fin_daily_closing (branchId ASC, date DESC) added in Task 2.4.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import type { FinanceDailyClosing } from '@/modules/daily-closing/types';
import { getFirebaseFirestore } from '@/core/firebase/firebaseClient';
import { DEFAULT_BRANCH_ID } from '@/constants/finance';

export function useDailyClosingHistory(
  dateFrom: string,
  dateTo: string,
): UseQueryResult<FinanceDailyClosing[]> {
  return useQuery({
    queryKey: ['dailyClosingHistory', dateFrom, dateTo],
    queryFn: async () => {
      const db = getFirebaseFirestore();
      const snapshot = await getDocs(
        query(
          collection(db, 'fin_daily_closing'),
          where('branchId', '==', DEFAULT_BRANCH_ID),
          where('date', '>=', dateFrom),
          where('date', '<=', dateTo),
          orderBy('date', 'desc'),
        ),
      );
      return snapshot.docs.map(d => ({
        id: d.id,
        ...d.data(),
      })) as FinanceDailyClosing[];
    },
    staleTime: 60_000, // 1 min — history doesn't need to be as fresh as today's doc
  });
}
