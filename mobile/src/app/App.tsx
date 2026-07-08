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
import { logger } from '@/core/logging/logger';
import { QueryProvider } from '@/app/providers/QueryProvider';
import { AuthProvider } from '@/app/providers/AuthProvider';
import { ConnectivityProvider } from '@/app/providers/ConnectivityProvider';
import { RootNavigator } from '@/navigation/RootNavigator';

// Install once before rendering (Requirement 17.1 — global unhandled rejection capture)
installGlobalErrorHandlers();

// ==========================================
// DIAGNOSTIC LOGGING FOR XCODE CONSOLE
// ==========================================
// These logs help diagnose why logs aren't appearing in Xcode console

// 1. Test raw console.log first (most basic test)
console.log('==========================================');
console.log('🚀 APP STARTUP DIAGNOSTICS');
console.log('==========================================');

// 2. Test all console methods
console.log('[TEST] console.log works');
console.info('[TEST] console.info works');
console.warn('[TEST] console.warn works');
console.error('[TEST] console.error works');

// 3. Print environment information
console.log('Build mode:', __DEV__ ? 'DEVELOPMENT' : 'PRODUCTION');
console.log('__DEV__:', __DEV__);
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('APP_ENV:', process.env.APP_ENV);

// 4. Import and print config values
import { API_BASE } from '@/config';
import { APP_VERSION, BUILD_NUMBER, ENVIRONMENT, FIREBASE_PROJECT } from '@/core/diagnostics/deviceInfo';

console.log('Resolved BACKEND_URL:', process.env.BACKEND_URL);
console.log('API_BASE:', API_BASE);
console.log('APP_VERSION:', APP_VERSION);
console.log('BUILD_NUMBER:', BUILD_NUMBER);
console.log('ENVIRONMENT:', ENVIRONMENT);
console.log('FIREBASE_PROJECT:', FIREBASE_PROJECT);

// 5. Check logger configuration
import { getLoggerConfig } from '@/core/logging/logger';
const loggerConfig = getLoggerConfig();
console.log('Logger initialized:', true);
console.log('Logger consoleEnabled:', loggerConfig.consoleEnabled);
console.log('Logger persistEnabled:', loggerConfig.persistEnabled);
console.log('Logger minLevel:', loggerConfig.minLevel);

console.log('==========================================');

// 6. Now test logger
logger.info('app', 'App started');
logger.warn('app', 'Logger test: This should appear in both console and persistent logs');
logger.error('app', 'Logger error test');

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
