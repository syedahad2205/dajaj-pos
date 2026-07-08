/**
 * TanStack Query hook for active expense categories (design §6.1, Requirement 9.2).
 *
 * Query: fin_expense_categories where branchId == DEFAULT_BRANCH_ID and active == true
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { collection, getDocs, query, where } from 'firebase/firestore';
import type { FinanceExpenseCategory } from '@/modules/daily-closing/types';
import { getFirebaseFirestore } from '@/core/firebase/firebaseClient';
import { DEFAULT_BRANCH_ID } from '@/constants/finance';

export function useExpenseCategories(): UseQueryResult<FinanceExpenseCategory[]> {
  return useQuery({
    queryKey: ['expenseCategories'],
    queryFn: async () => {
      const db = getFirebaseFirestore();
      const snapshot = await getDocs(
        query(
          collection(db, 'fin_expense_categories'),
          where('branchId', '==', DEFAULT_BRANCH_ID),
          where('active', '==', true),
        ),
      );
      return snapshot.docs.map(d => ({
        id: d.id,
        ...d.data(),
      })) as FinanceExpenseCategory[];
    },
    staleTime: 5 * 60_000, // 5 min — categories change infrequently
  });
}
