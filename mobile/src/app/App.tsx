/**
 * Root app component (Task 30.1 — final wiring).
 *
 * Provider nesting order (outer → inner):
 *   ErrorBoundary → QueryProvider → AuthProvider → ConnectivityProvider → RootNavigator
 *
 * This is the only place Daily Closing is a "special case" in the app shell —
 * AppNavigator iterates REGISTERED_MODULES for tabs, not hard-coded screens (Task 30.2).
 */
import React from 'react';
import { ErrorBoundary } from '@/core/logging/ErrorBoundary';
import { installGlobalErrorHandlers } from '@/core/logging/errorLogStore';
import { QueryProvider } from '@/app/providers/QueryProvider';
import { AuthProvider } from '@/app/providers/AuthProvider';
import { ConnectivityProvider } from '@/app/providers/ConnectivityProvider';
import { RootNavigator } from '@/navigation/RootNavigator';

// Install once before rendering (Requirement 17.1 — global unhandled rejection capture)
installGlobalErrorHandlers();

export default function App() {
  return (
    <ErrorBoundary>
      <QueryProvider>
        <AuthProvider>
          <ConnectivityProvider>
            <RootNavigator />
          </ConnectivityProvider>
        </AuthProvider>
      </QueryProvider>
    </ErrorBoundary>
  );
}
