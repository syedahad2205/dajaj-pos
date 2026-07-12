/**
 * TanStack Query hook for active expense subcategories (mirrors the web
 * /expense-subcategories endpoint). Used by the bulk Add Expense modal so a
 * subcategory picker can be shown only when the selected category has one.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';
import type { FinanceExpenseSubcategory } from '@/modules/daily-closing/types';
import { getFirebaseFirestore } from '@/core/firebase/firebaseClient';

export function useExpenseSubcategories(): UseQueryResult<FinanceExpenseSubcategory[]> {
  return useQuery({
    queryKey: ['expenseSubcategories'],
    queryFn: async () => {
      const db = getFirebaseFirestore();
      const snapshot = await getDocs(
        query(collection(db, 'fin_expense_subcategories'), where('active', '==', true), orderBy('displayOrder', 'asc')),
      );
      return snapshot.docs.map(d => ({
        id: d.id,
        ...d.data(),
      })) as FinanceExpenseSubcategory[];
    },
    staleTime: 5 * 60_000, // 5 min — subcategories change infrequently
  });
}
