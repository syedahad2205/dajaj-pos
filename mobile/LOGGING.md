# Centralized Logging System

## Overview

The DAJAJ Finance mobile app now includes a **permanent, production-ready centralized logging infrastructure** that automatically captures:

- ✅ All HTTP requests and responses
- ✅ Authentication flow events
- ✅ Firebase SDK events
- ✅ Sync operations
- ✅ Offline queue operations
- ✅ Connectivity changes
- ✅ Runtime exceptions
- ✅ App lifecycle events

## Architecture

### Core Components

1. **`core/logging/logger.ts`** — Central logging service
   - Structured log levels: TRACE, DEBUG, INFO, WARN, ERROR
   - Automatic sensitive value masking (passwords, tokens, keys)
   - Dual output: console (dev) + MMKV persistent storage
   - Automatic rotation (500 entries max by default)
   - Async-safe: never blocks UI

2. **`core/logging/LogViewerScreen.tsx`** — Log viewer UI
   - View all logs with search and level filtering
   - Tap to expand entries with data
   - Export logs via Share sheet (for bug reports)
   - Clear logs
   - Accessible from Settings → Diagnostics → View Logs

### Integration Points

All logging happens **automatically** at the infrastructure layer — no additional logging needed in screens or business logic:

- **Network layer** (`core/api/apiClient.ts`) — Every fetch logs request/response/failure
- **Auth API** (`core/auth/authApi.ts`) — Login flow logging
- **Firebase client** (`core/firebase/firebaseClient.ts`) — SDK init + auth state
- **Auth provider** (`app/providers/AuthProvider.tsx`) — Session lifecycle
- **Login screen** (`modules/daily-closing/screens/LoginScreen.tsx`) — Button presses + auth steps
- **Mutation queue** (`core/offline/mutationQueue.ts`) — Enqueue/dequeue/clear events
- **Queue processor** (`core/offline/QueueProcessor.ts`) — Sync operations
- **Connectivity provider** (`app/providers/ConnectivityProvider.tsx`) — Online/offline transitions
- **Error handlers** (`core/logging/errorLogStore.ts`, `ErrorBoundary.tsx`) — Exceptions

### Security

Sensitive fields are **automatically masked**:
- Passwords (never logged)
- Authorization headers (Bearer tokens are masked: `Bearer eyJhbG...1234`)
- ID tokens, custom tokens, refresh tokens
- API keys, secrets, credentials

Masking is enforced by:
- `sanitize()` — recursively masks objects/arrays
- `sanitizeHeaders()` — special handling for Authorization header
- `maskToken()` — keeps first 6 + last 4 chars

### Configuration

```typescript
import { configureLogger } from '@/core/logging/logger';

configureLogger({
  minLevel: 'DEBUG',          // TRACE | DEBUG | INFO | WARN | ERROR
  consoleEnabled: true,       // Print to JS console
  persistEnabled: true,       // Save to MMKV
  maxStoredEntries: 500,      // Rotation cap
});
```

Default config:
- Production: INFO level, console off, persist on
- Development: DEBUG level, console on, persist on

## Usage

### Automatic Logging

Most events are logged automatically by the infrastructure. No changes needed in screens or services.

### Manual Logging

For custom events:

```typescript
import { logger } from '@/core/logging/logger';

// Simple log
logger.info('app', 'Custom event occurred');

// With data (auto-sanitized)
logger.info('app', 'Button pressed', { screen: 'DailyClosing', buttonId: 'save' });

// Exception logging
try {
  // ...
} catch (err) {
  logger.exception('MyScreen', 'myOperation', err, { context: 'additional info' });
}
```

### Log Categories

- **network** — HTTP requests/responses
- **auth** — Authentication flow
- **firebase** — Firebase SDK events
- **sync** — Sync operations
- **queue** — Mutation queue
- **connectivity** — Online/offline
- **error** — Runtime exceptions
- **app** — General app events

### Specialized Helpers

```typescript
// Network logging (used by apiClient.ts)
logger.network.request(requestId, method, url, headers, body, { username, isOnline });
logger.network.response(requestId, statusCode, statusText, durationMs, body);
logger.network.failure(requestId, error, requestBody);

// Auth flow (used by authApi.ts, LoginScreen.tsx, AuthProvider.tsx)
logger.auth.loginStart(username);
logger.auth.loginSuccess(username, uid);
logger.auth.loginFailure(username, message);
logger.auth.customTokenReceived();
logger.auth.firebaseSignInStart();
logger.auth.firebaseSignInSuccess(uid);
logger.auth.tokenRefreshed();
logger.auth.sessionRestored(uid);
logger.auth.signedOut(reason);
logger.auth.sessionInvalidated(message);

// Firebase SDK (used by firebaseClient.ts, AuthProvider.tsx)
logger.firebase.initialized(projectId);
logger.firebase.authStateChanged(event, uid);
logger.firebase.permissionDenied(context);

// Sync (used by QueueProcessor.ts)
logger.sync.started(dateCount);
logger.sync.completed(dequeued);
logger.sync.failed(message);
logger.sync.dateStarted(targetDate, itemCount);
logger.sync.itemSuccess(id, operation, targetDate);
logger.sync.itemFailed(id, operation, targetDate, message, retryCount);
logger.sync.itemRetrying(id, operation, retryCount);

// Queue (used by mutationQueue.ts)
logger.queue.enqueued(id, operation, targetDate, isOffline);
logger.queue.dequeued(id, operation);
logger.queue.cleared();
logger.queue.dateFailed(targetDate, reason);

// Connectivity (used by ConnectivityProvider.tsx)
logger.connectivity.changed(isOnline, slowNetwork);
logger.connectivity.syncTriggered(trigger);

// Exception (used by ErrorBoundary.tsx, errorLogStore.ts, try/catch blocks)
logger.exception(screen, operation, error, context);
```

## Storage

Logs are persisted in MMKV under the key `app_log`.

- **Maximum retained entries**: 500 (configurable via `maxStoredEntries`)
- **Rotation**: Oldest entries are evicted when the cap is reached
- **Storage ID**: `dajaj-finance-app-log`
- **Performance**: Writes happen asynchronously via `setImmediate()` — never blocks UI

## Viewing Logs

### In-App Viewer

1. Navigate to **Settings** tab
2. Scroll to **Diagnostics** section
3. Tap **📋 View Logs**

Features:
- Search by message, category, or data content
- Filter by log level (TRACE/DEBUG/INFO/WARN/ERROR)
- Tap entries to expand and see full data
- Refresh, Export, Clear actions

### Export Logs

From Settings → Diagnostics:
- Tap **⬆ Export** — Opens Share sheet with formatted log text
- Suitable for attaching to bug reports or support tickets

Format:
```
═══════════════════════════════════════════════
 DAJAJ Finance — Application Log Export
 Exported: 2026-07-08T15:42:18.000Z
 App Version: 0.1.0
 Environment: development
 Platform: ios
═══════════════════════════════════════════════

[2026-07-08T15:42:18.123Z] [INFO] [app] App started
[2026-07-08T15:42:19.456Z] [INFO] [firebase] Firebase app initialized
  {
    "projectId": "dajaj-pos"
  }
[2026-07-08T15:42:20.789Z] [DEBUG] [network] ➡️  REQUEST #42
  {
    "requestId": 42,
    "method": "POST",
    "url": "/api/mobile/v1/finance/auth/login",
    "headers": {
      "Authorization": "Bearer ***MASKED***"
    },
    "user": "cashier",
    "network": "online"
  }
...
```

### Clear Logs

From Settings → Diagnostics:
- Tap **🗑 Clear** — Permanently deletes all stored logs after confirmation

## Request ID Tracking

Every HTTP request is assigned a sequential ID. Use this to trace the complete lifecycle:

```
➡️  REQUEST #42  POST /api/mobile/v1/finance/auth/login
  [request details]

⬅️  RESPONSE #42  200 OK  (184 ms)
  [response details]
```

Failed requests also reference the same ID:

```
❌ FAILED #42 Network request failed
  [error details]
```

## Example Log Flow: Sign-In

```
[INFO] [app] App started
[INFO] [firebase] Firebase app initialized
[DEBUG] [firebase] Firebase Auth initialized with AsyncStorage persistence
[INFO] [firebase] Auth state changed: signed-out

[INFO] [auth] Login button pressed
[INFO] [auth] Login attempt started

[DEBUG] [network] ➡️  REQUEST #1  POST /api/mobile/v1/finance/auth/login
  {
    "username": "cashier",
    "password": "[REDACTED]"
  }

[INFO] [network] ⬅️  RESPONSE #1  200 OK  (184 ms)
  {
    "success": true,
    "customToken": "eyJhbG...1234",  // auto-masked
    "user": {
      "id": "abc123",
      "username": "cashier",
      "fullName": "Cashier User"
    }
  }

[DEBUG] [auth] Custom token received from server (value masked)
[DEBUG] [auth] signInWithCustomToken() started
[INFO] [auth] signInWithCustomToken() completed
[INFO] [auth] Login successful

[INFO] [firebase] Auth state changed: signed-in
[INFO] [auth] Session restored from persistence
```

## Performance

- **Console logging**: Disabled in production by default
- **Persistent writes**: Async via `setImmediate()` — never blocks the UI
- **Sanitization**: Recursive but capped at depth 8 to prevent runaway CPU usage
- **Rotation**: Automatic — oldest entries evicted when cap is reached

## Future Enhancements

Possible future additions:
- Remote log upload to a logging service (Firebase Crashlytics, Sentry, etc.)
- Per-category log level configuration
- Log filtering by date range
- Search by user/device ID
- Automatic log upload on crash

## Files Modified

### New Files Created
- `mobile/src/core/logging/logger.ts` — Central logger
- `mobile/src/core/logging/LogViewerScreen.tsx` — Log viewer UI

### Existing Files Modified (integration only, no business logic changes)
- `mobile/src/core/api/apiClient.ts` — Network logging
- `mobile/src/core/auth/authApi.ts` — Auth API logging
- `mobile/src/core/firebase/firebaseClient.ts` — Firebase init logging
- `mobile/src/app/providers/AuthProvider.tsx` — Auth state logging
- `mobile/src/modules/daily-closing/screens/LoginScreen.tsx` — Login flow logging
- `mobile/src/core/offline/mutationQueue.ts` — Queue operation logging
- `mobile/src/core/offline/QueueProcessor.ts` — Sync operation logging
- `mobile/src/app/providers/ConnectivityProvider.tsx` — Connectivity logging
- `mobile/src/core/logging/errorLogStore.ts` — Route errors through logger
- `mobile/src/core/logging/ErrorBoundary.tsx` — Route caught errors through logger
- `mobile/src/core/auth/useAuthStore.ts` — Sign-out logging
- `mobile/src/core/ui/screens/SettingsScreen.tsx` — Log viewer buttons
- `mobile/src/navigation/AppNavigator.tsx` — LogViewer screen registration
- `mobile/src/app/App.tsx` — App startup logging

---

**The logging system is now a permanent part of the application's core infrastructure.**
