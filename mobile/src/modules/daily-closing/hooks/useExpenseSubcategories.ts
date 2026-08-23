/**
 * TanStack Query hook for active expense subcategories (mirrors the web
 * /expense-subcategories endpoint). Used by the bulk Add Expense modal so a
 * subcategory picker can be shown only when the selected category has one.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import type { FinanceExpenseSubcategory } from '@/modules/daily-closing/types';
import { getFirebaseFirestore } from '@/core/firebase/firebaseClient';

export function useExpenseSubcategories(): UseQueryResult<FinanceExpenseSubcategory[]> {
  return useQuery({
    queryKey: ['expenseSubcategories'],
    queryFn: async () => {
      const db = getFirebaseFirestore();
      // No composite index needed: fetch all by displayOrder, filter active in-memory.
      // (where('active') + orderBy('displayOrder') requires a Firestore composite
      // index that may not exist — same pattern as the web financeCategoriesService.)
      const snapshot = await getDocs(
        query(collection(db, 'fin_expense_subcategories'), orderBy('displayOrder', 'asc')),
      );
      return snapshot.docs
        .map(d => ({ id: d.id, ...d.data() }) as FinanceExpenseSubcategory)
        .filter(s => s.active);
    },
    staleTime: 5 * 60_000, // 5 min — subcategories change infrequently
  });
}
