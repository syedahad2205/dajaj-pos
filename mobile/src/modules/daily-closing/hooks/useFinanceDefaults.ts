/**
 * TanStack Query hook for Finance Defaults (design §6.1, Requirement 9.3).
 *
 * Query: finance_defaults where branchId == DEFAULT_BRANCH_ID
 * Used by the Daily Summary section to show which events are/aren't configured for auto-posting.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { collection, getDocs, query, where } from 'firebase/firestore';
import type { FinanceDefault } from '@/modules/daily-closing/types';
import { getFirebaseFirestore } from '@/core/firebase/firebaseClient';
import { DEFAULT_BRANCH_ID } from '@/constants/finance';

export function useFinanceDefaults(): UseQueryResult<FinanceDefault[]> {
  return useQuery({
    queryKey: ['financeDefaults'],
    queryFn: async () => {
      const db = getFirebaseFirestore();
      const snapshot = await getDocs(
        query(
          collection(db, 'finance_defaults'),
          where('branchId', '==', DEFAULT_BRANCH_ID),
        ),
      );
      return snapshot.docs.map(d => ({
        id: d.id,
        ...d.data(),
      })) as FinanceDefault[];
    },
    staleTime: 10 * 60_000, // 10 min — defaults rarely change
  });
}
