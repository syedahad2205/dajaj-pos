/**
 * TanStack Query provider — wraps the app with a QueryClient.
 * The QueryClient is initialised here and also passed to QueueProcessor
 * so it can call setQueryData after successful mutation replay.
 */
import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { initQueueProcessor } from '@/core/offline/QueueProcessor';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 30_000, // 30 s default; overridden per-query for locked documents
    },
  },
});

// Wire the queue processor with the shared query client and an ID token getter.
// The token getter is lazy — it only calls getFirebaseAuth() when runAll() is
// triggered (after auth is initialized), never at module load time.
initQueueProcessor(queryClient, async () => {
  try {
    const { getFirebaseAuth } = await import('@/core/firebase/firebaseClient');
    const auth = getFirebaseAuth();
    return (await auth.currentUser?.getIdToken()) ?? null;
  } catch {
    return null;
  }
});

export function QueryProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

export { queryClient };
