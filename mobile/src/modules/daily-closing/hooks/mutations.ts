/**
 * Shared mutation hook factory (design §6.2, Requirement 4.1, 4.6, 6.2, 10.1, 10.7).
 *
 * Each mutation hook follows the same pattern:
 *   1. If online → call apiClient directly → setQueryData with returned closing
 *   2. If offline → enqueue via mutationQueue (no network call)
 *
 * The factory keeps the boilerplate in one place; each named hook is just a
 * thin wrapper with the correct operation + path builder.
 */
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { useConnectivityStore } from '@/core/connectivity/useConnectivityStore';
import { apiCall } from '@/core/api/apiClient';
import { enqueue, type MutationOperation } from '@/core/offline/mutationQueue';
import { getFirebaseAuth } from '@/core/firebase/firebaseClient';
import { getDeviceId, APP_VERSION } from '@/core/diagnostics/deviceInfo';
import type { FinanceDailyClosing } from '@/modules/daily-closing/types';

// Resolved at first use — cached after first call since deviceId is stable
let _deviceId: string | null = null;
function deviceId(): string {
  if (!_deviceId) _deviceId = getDeviceId();
  return _deviceId;
}

export interface MutationCallOptions<TPayload> {
  operation: MutationOperation;
  targetDate: string;
  /** REST path relative to API_BASE, e.g. "/finance/closing/2025-07-07/expenses" */
  path: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  payload: TPayload;
  idToken: string;
}

async function getIdToken(): Promise<string> {
  const auth = getFirebaseAuth();
  // On iOS, currentUser can be null briefly after signInWithCustomToken
  // before onAuthStateChanged fires. Wait for auth state if needed.
  let currentUser = auth.currentUser;
  if (!currentUser) {
    currentUser = await new Promise((resolve) => {
      const unsub = auth.onAuthStateChanged((u) => {
        unsub();
        resolve(u);
      });
    });
  }
  const token = await currentUser?.getIdToken();
  if (!token) throw new Error('Not authenticated.');
  return token;
}

/** The core online/offline mutation dispatch logic. */
async function dispatchMutation<TPayload extends object>(
  options: MutationCallOptions<TPayload>,
  isOnline: boolean,
  setClosingCache: (closing: FinanceDailyClosing) => void,
): Promise<void> {
  if (isOnline) {
    // Online path: call the API route directly
    const result = await apiCall({
      method: options.method,
      path: options.path,
      body: options.method !== 'DELETE' ? options.payload : undefined,
      idToken: options.idToken,
      idempotencyKey: undefined, // Online mutations generate their key server-side
    });
    if (!result.success) {
      throw new Error(result.message);
    }
    // Cache the server's authoritative closing (Requirement 6.2)
    setClosingCache(result.closing);
  } else {
    // Offline path: enqueue the mutation (Requirement 10.1)
    enqueue(options.operation, options.targetDate, options.payload, {
      deviceId: deviceId(),
      clientVersion: APP_VERSION,
      isOffline: true,
    });
    // Update connectivity store to reflect pending state
    useConnectivityStore.getState().recomputeSyncStatus(true, false);
  }
}

// ─── Named hooks ─────────────────────────────────────────────────────────────

export function useAddExpense(date: string) {
  const queryClient = useQueryClient();
  const { isOnline } = useConnectivityStore();

  return useMutation({
    mutationFn: async (input: { categoryId: string; amount: number; remarks?: string }) => {
      const idToken = await getIdToken();
      await dispatchMutation(
        {
          operation: 'addExpense',
          targetDate: date,
          path: `/finance/closing/${date}/expenses`,
          method: 'POST',
          payload: input,
          idToken,
        },
        isOnline,
        (closing: FinanceDailyClosing) => queryClient.setQueryData<FinanceDailyClosing | null>(['dailyClosing', date], closing),
      );
    },
  });
}

export function useRemoveExpense(date: string) {
  const queryClient = useQueryClient();
  const { isOnline } = useConnectivityStore();

  return useMutation({
    mutationFn: async (entryId: string) => {
      const idToken = await getIdToken();
      await dispatchMutation(
        {
          operation: 'removeExpense',
          targetDate: date,
          path: `/finance/closing/${date}/expenses/${entryId}`,
          method: 'DELETE',
          payload: { entryId },
          idToken,
        },
        isOnline,
        (closing: FinanceDailyClosing) => queryClient.setQueryData<FinanceDailyClosing | null>(['dailyClosing', date], closing),
      );
    },
  });
}

export function useAddDeposit(date: string) {
  const queryClient = useQueryClient();
  const { isOnline } = useConnectivityStore();

  return useMutation({
    mutationFn: async (input: { type: string; amount: number; remarks?: string }) => {
      const idToken = await getIdToken();
      await dispatchMutation(
        {
          operation: 'addDeposit',
          targetDate: date,
          path: `/finance/closing/${date}/deposits`,
          method: 'POST',
          payload: input,
          idToken,
        },
        isOnline,
        (closing: FinanceDailyClosing) => queryClient.setQueryData<FinanceDailyClosing | null>(['dailyClosing', date], closing),
      );
    },
  });
}

export function useRemoveDeposit(date: string) {
  const queryClient = useQueryClient();
  const { isOnline } = useConnectivityStore();

  return useMutation({
    mutationFn: async (entryId: string) => {
      const idToken = await getIdToken();
      await dispatchMutation(
        {
          operation: 'removeDeposit',
          targetDate: date,
          path: `/finance/closing/${date}/deposits/${entryId}`,
          method: 'DELETE',
          payload: { entryId },
          idToken,
        },
        isOnline,
        (closing: FinanceDailyClosing) => queryClient.setQueryData<FinanceDailyClosing | null>(['dailyClosing', date], closing),
      );
    },
  });
}

export function useUpdateSales(date: string) {
  const queryClient = useQueryClient();
  const { isOnline } = useConnectivityStore();

  return useMutation({
    mutationFn: async (input: {
      upiSales?: number;
      zomatoSales?: number;
      swiggySales?: number;
      otherIncome?: number;
    }) => {
      const idToken = await getIdToken();
      await dispatchMutation(
        {
          operation: 'updateSales',
          targetDate: date,
          path: `/finance/closing/${date}/sales`,
          method: 'PATCH',
          payload: input,
          idToken,
        },
        isOnline,
        (closing: FinanceDailyClosing) => queryClient.setQueryData<FinanceDailyClosing | null>(['dailyClosing', date], closing),
      );
    },
  });
}

export function useSetOpeningCash(date: string) {
  const queryClient = useQueryClient();
  const { isOnline } = useConnectivityStore();

  return useMutation({
    mutationFn: async (openingCash: number) => {
      const idToken = await getIdToken();
      await dispatchMutation(
        {
          operation: 'setOpeningCash',
          targetDate: date,
          path: `/finance/closing/${date}/opening-cash`,
          method: 'PATCH',
          payload: { openingCash },
          idToken,
        },
        isOnline,
        (closing: FinanceDailyClosing) => queryClient.setQueryData<FinanceDailyClosing | null>(['dailyClosing', date], closing),
      );
    },
  });
}

export function useCloseDailyClosing(date: string) {
  const queryClient = useQueryClient();
  const { isOnline } = useConnectivityStore();

  return useMutation({
    mutationFn: async (closingCash: number) => {
      const idToken = await getIdToken();
      // closeDailyClosing: offline path enqueues via mutationQueue (which enforces
      // close-last ordering for the same date). Queue itself is responsible for
      // ensuring it is always ordered after other pending mutations (Requirement 10.6).
      await dispatchMutation(
        {
          operation: 'closeDailyClosing',
          targetDate: date,
          path: `/finance/closing/${date}`,
          method: 'PATCH',
          payload: { closingCash },
          idToken,
        },
        isOnline,
        (closing: FinanceDailyClosing) => queryClient.setQueryData<FinanceDailyClosing | null>(['dailyClosing', date], closing),
      );
    },
  });
}
