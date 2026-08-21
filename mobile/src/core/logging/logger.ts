/**
 * Centralized logging service — permanent infrastructure for the DAJAJ Finance app.
 *
 * Features:
 *  - Structured log levels: TRACE < DEBUG < INFO < WARN < ERROR
 *  - Automatic masking of sensitive values (tokens, passwords, keys)
 *  - Dual output: console (dev) + MMKV persistent storage (always)
 *  - Automatic rotation: newest MAX_STORED_ENTRIES entries kept
 *  - Async-safe: never blocks the UI (writes are fire-and-forget)
 *  - Centrally configurable via LoggerConfig
 *
 * Usage:
 *   import { logger } from '@/core/logging/logger';
 *   logger.info('auth', 'Login successful', { username: 'cashier' });
 *   logger.network.request(42, 'POST', '/api/...', headers, body);
 *   logger.auth.loginStart('cashier');
 */
import { MMKV } from 'react-native-mmkv';
import { Platform } from 'react-native';
import { APP_VERSION, ENVIRONMENT, getDeviceId } from '@/core/diagnostics/deviceInfo';

// ─── Storage ──────────────────────────────────────────────────────────────────

const storage = new MMKV({ id: 'dajaj-finance-app-log' });
const LOG_KEY = 'app_log';

// ─── Configuration ────────────────────────────────────────────────────────────

export type LogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LEVEL_RANK: Record<LogLevel, number> = {
  TRACE: 0,
  DEBUG: 1,
  INFO: 2,
  WARN: 3,
  ERROR: 4,
};

export interface LoggerConfig {
  /** Minimum level to process. Entries below this are discarded. Default: 'DEBUG' */
  minLevel: LogLevel;
  /** Whether to print to the JS console. Default: true in development. */
  consoleEnabled: boolean;
  /** Whether to persist to MMKV. Default: true. */
  persistEnabled: boolean;
  /** Maximum entries to retain in persistent storage. Default: 500. */
  maxStoredEntries: number;
}

let config: LoggerConfig = {
  minLevel: ENVIRONMENT === 'production' ? 'INFO' : 'DEBUG',
  consoleEnabled: ENVIRONMENT !== 'production',
  persistEnabled: true,
  maxStoredEntries: 500,
};

export function configureLogger(overrides: Partial<LoggerConfig>): void {
  config = { ...config, ...overrides };
}

/**
 * Get the current logger configuration.
 * Useful for diagnostics and debugging.
 */
export function getLoggerConfig(): LoggerConfig {
  return { ...config };
}

// ─── Log Entry ────────────────────────────────────────────────────────────────

export type LogCategory =
  | 'network'
  | 'auth'
  | 'firebase'
  | 'sync'
  | 'queue'
  | 'connectivity'
  | 'error'
  | 'app';

export interface LogEntry {
  id: string;
  timestamp: string;       // ISO 8601
  level: LogLevel;
  category: LogCategory;
  message: string;
  data?: Record<string, unknown>;
  // Context snapshot at log time
  platform: string;
  appVersion: string;
  deviceId: string;
}

// ─── Security: sensitive field masking ───────────────────────────────────────

/**
 * Fields whose values should never appear in logs in full.
 * Values are replaced with '***MASKED***'.
 */
const SENSITIVE_KEYS = new Set([
  'password',
  'pass',
  'secret',
  'token',
  'idtoken',
  'id_token',
  'customtoken',
  'custom_token',
  'refreshtoken',
  'refresh_token',
  'apikey',
  'api_key',
  'authorization',
  'accesstoken',
  'access_token',
  'credential',
  'private_key',
  'privatekey',
]);

/** Mask tokens: keep first 6 + last 4 chars, replace middle with *** */
function maskToken(value: string): string {
  if (value.length <= 12) return '***MASKED***';
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

/** Recursively sanitize an object, masking sensitive fields. */
export function sanitize(obj: unknown, depth = 0): unknown {
  if (depth > 8) return '[deep]';
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return obj;
  if (typeof obj === 'number' || typeof obj === 'boolean') return obj;
  if (Array.isArray(obj)) return obj.map(item => sanitize(item, depth + 1));
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (SENSITIVE_KEYS.has(lowerKey)) {
        if (typeof value === 'string' && value.length > 0) {
          result[key] = maskToken(value);
        } else {
          result[key] = '***MASKED***';
        }
      } else {
        result[key] = sanitize(value, depth + 1);
      }
    }
    return result;
  }
  return obj;
}

/** Sanitize HTTP headers specifically — Authorization header gets special handling. */
export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'authorization') {
      if (value.startsWith('Bearer ')) {
        result[key] = `Bearer ${maskToken(value.slice(7))}`;
      } else {
        result[key] = '***MASKED***';
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ─── Counter for request IDs ──────────────────────────────────────────────────

let _requestCounter = 0;
export function nextRequestId(): number {
  return ++_requestCounter;
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

function readEntries(): LogEntry[] {
  try {
    const raw = storage.getString(LOG_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as LogEntry[];
  } catch {
    return [];
  }
}

function writeEntries(entries: LogEntry[]): void {
  try {
    storage.set(LOG_KEY, JSON.stringify(entries));
  } catch {
    // Storage failure must never crash the app
  }
}

function persistEntry(entry: LogEntry): void {
  if (!config.persistEnabled) return;
  // Use setImmediate to avoid blocking any synchronous call stack
  setImmediate(() => {
    try {
      const entries = readEntries();
      entries.push(entry);
      const trimmed =
        entries.length > config.maxStoredEntries
          ? entries.slice(entries.length - config.maxStoredEntries)
          : entries;
      writeEntries(trimmed);
    } catch {
      // Silently ignore storage errors
    }
  });
}

// ─── Console output ───────────────────────────────────────────────────────────

const LEVEL_EMOJI: Record<LogLevel, string> = {
  TRACE: '🔍',
  DEBUG: '🐛',
  INFO: 'ℹ️ ',
  WARN: '⚠️ ',
  ERROR: '❌',
};

const CATEGORY_EMOJI: Record<LogCategory, string> = {
  network: '🌐',
  auth: '🔐',
  firebase: '🔥',
  sync: '🔄',
  queue: '📋',
  connectivity: '📶',
  error: '💥',
  app: '📱',
};

function toConsole(entry: LogEntry): void {
  if (!config.consoleEnabled) return;
  const prefix = `${LEVEL_EMOJI[entry.level]} ${CATEGORY_EMOJI[entry.category]} [${entry.level}][${entry.category}] ${entry.timestamp.slice(11, 23)}`;
  const msg = `${prefix} ${entry.message}`;
  if (entry.data && Object.keys(entry.data).length > 0) {
     
    console.log(msg, entry.data);
  } else {
     
    console.log(msg);
  }
}

// ─── Core write function ──────────────────────────────────────────────────────

function write(
  level: LogLevel,
  category: LogCategory,
  message: string,
  data?: Record<string, unknown>,
): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[config.minLevel]) return;

  const entry: LogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    level,
    category,
    message,
    data: data ? (sanitize(data) as Record<string, unknown>) : undefined,
    platform: Platform.OS,
    appVersion: APP_VERSION,
    deviceId: getDeviceId(),
  };

  toConsole(entry);
  persistEntry(entry);
}

// ─── Public log API ───────────────────────────────────────────────────────────

export const logger = {
  trace: (category: LogCategory, message: string, data?: Record<string, unknown>) =>
    write('TRACE', category, message, data),
  debug: (category: LogCategory, message: string, data?: Record<string, unknown>) =>
    write('DEBUG', category, message, data),
  info: (category: LogCategory, message: string, data?: Record<string, unknown>) =>
    write('INFO', category, message, data),
  warn: (category: LogCategory, message: string, data?: Record<string, unknown>) =>
    write('WARN', category, message, data),
  error: (category: LogCategory, message: string, data?: Record<string, unknown>) =>
    write('ERROR', category, message, data),

  // ── Namespaced helpers ────────────────────────────────────────────────────

  /** Network request/response helpers. */
  network: {
    request(
      requestId: number,
      method: string,
      url: string,
      headers: Record<string, string>,
      body: unknown,
      context?: { user?: string; isOnline?: boolean },
    ): void {
      write('DEBUG', 'network', `➡️  REQUEST #${requestId}`, {
        requestId,
        method,
        url,
        headers: sanitizeHeaders(headers),
        body: sanitize(body),
        user: context?.user ?? '(unauthenticated)',
        network: context?.isOnline === false ? 'offline' : 'online',
      });
    },

    response(
      requestId: number,
      statusCode: number,
      statusText: string,
      durationMs: number,
      body: unknown,
    ): void {
      const level: LogLevel = statusCode >= 500 ? 'ERROR' : statusCode >= 400 ? 'WARN' : 'INFO';
      write(level, 'network', `⬅️  RESPONSE #${requestId} ${statusCode} ${statusText}`, {
        requestId,
        statusCode,
        statusText,
        durationMs,
        body: sanitize(body),
      });
    },

    failure(
      requestId: number,
      error: unknown,
      requestBody?: unknown,
    ): void {
      const err = error instanceof Error ? error : new Error(String(error));
      write('ERROR', 'network', `❌ FAILED #${requestId} ${err.message}`, {
        requestId,
        message: err.message,
        stack: err.stack,
        requestBody: sanitize(requestBody),
      });
    },
  },

  /** Authentication flow helpers. */
  auth: {
    loginStart(username: string): void {
      write('INFO', 'auth', 'Login attempt started', { username });
    },
    loginSuccess(username: string, uid: string): void {
      write('INFO', 'auth', 'Login successful', { username, uid: uid.slice(0, 8) + '...' });
    },
    loginFailure(username: string, message: string): void {
      write('WARN', 'auth', 'Login failed', { username, message });
    },
    customTokenReceived(): void {
      write('DEBUG', 'auth', 'Custom token received from server (value masked)');
    },
    firebaseSignInStart(): void {
      write('DEBUG', 'auth', 'signInWithCustomToken() started');
    },
    firebaseSignInSuccess(uid: string): void {
      write('INFO', 'auth', 'signInWithCustomToken() completed', { uid: uid.slice(0, 8) + '...' });
    },
    tokenRefreshed(): void {
      write('DEBUG', 'auth', 'ID token refreshed');
    },
    sessionRestored(uid: string): void {
      write('INFO', 'auth', 'Session restored from persistence', { uid: uid.slice(0, 8) + '...' });
    },
    signedOut(reason?: string): void {
      write('INFO', 'auth', 'User signed out', reason ? { reason } : undefined);
    },
    sessionInvalidated(message: string): void {
      write('WARN', 'auth', 'Session invalidated by server', { message });
    },
  },

  /** Firebase SDK helpers. */
  firebase: {
    initialized(projectId: string): void {
      write('INFO', 'firebase', 'Firebase app initialized', { projectId });
    },
    authStateChanged(event: 'signed-in' | 'signed-out', uid?: string): void {
      write('INFO', 'firebase', `Auth state changed: ${event}`, uid ? { uid: uid.slice(0, 8) + '...' } : undefined);
    },
    permissionDenied(context: string): void {
      write('WARN', 'firebase', 'Firestore permission denied', { context });
    },
  },

  /** Sync / queue processor helpers. */
  sync: {
    started(dateCount: number): void {
      write('INFO', 'sync', 'Sync started', { dateCount });
    },
    completed(dequeued: number): void {
      write('INFO', 'sync', 'Sync completed', { dequeued });
    },
    failed(message: string): void {
      write('ERROR', 'sync', 'Sync failed', { message });
    },
    dateStarted(targetDate: string, itemCount: number): void {
      write('DEBUG', 'sync', `Replaying queue for ${targetDate}`, { targetDate, itemCount });
    },
    itemSuccess(id: string, operation: string, targetDate: string): void {
      write('INFO', 'sync', `Queue item synced: ${operation}`, { id, operation, targetDate });
    },
    itemFailed(id: string, operation: string, targetDate: string, message: string, retryCount: number): void {
      write('WARN', 'sync', `Queue item failed: ${operation}`, { id, operation, targetDate, message, retryCount });
    },
    itemRetrying(id: string, operation: string, retryCount: number): void {
      write('DEBUG', 'sync', `Retrying queue item: ${operation} (attempt ${retryCount})`, { id, operation, retryCount });
    },
  },

  /** Mutation queue helpers. */
  queue: {
    enqueued(id: string, operation: string, targetDate: string, isOffline: boolean): void {
      write('INFO', 'queue', `Enqueued: ${operation}`, { id, operation, targetDate, isOffline });
    },
    dequeued(id: string, operation: string): void {
      write('DEBUG', 'queue', `Dequeued: ${operation}`, { id, operation });
    },
    cleared(): void {
      write('INFO', 'queue', 'Queue cleared (logout)');
    },
    dateFailed(targetDate: string, reason: string): void {
      write('WARN', 'queue', `Date queue failed: ${targetDate}`, { targetDate, reason });
    },
  },

  /** Connectivity helpers. */
  connectivity: {
    changed(isOnline: boolean, slowNetwork: boolean): void {
      write(isOnline ? 'INFO' : 'WARN', 'connectivity',
        isOnline ? '📶 Online' : '📵 Offline',
        { isOnline, slowNetwork });
    },
    syncTriggered(trigger: 'netinfo' | 'foreground' | 'manual'): void {
      write('DEBUG', 'connectivity', `Auto-sync triggered`, { trigger });
    },
  },

  /** Runtime error helpers. */
  exception(
    screen: string,
    operation: string | null,
    error: unknown,
    context?: Record<string, unknown>,
  ): void {
    const err = error instanceof Error ? error : new Error(String(error));
    write('ERROR', 'error', `Exception in ${screen}${operation ? `/${operation}` : ''}`, {
      screen,
      operation,
      message: err.message,
      stack: err.stack,
      ...context,
    });
  },
};

// ─── Persistent log management (for LogViewerScreen) ─────────────────────────

/** Read all persisted log entries (newest-first for display). */
export function getPersistedLogs(): LogEntry[] {
  return readEntries().reverse();
}

/** Clear all persisted logs. */
export function clearPersistedLogs(): void {
  storage.delete(LOG_KEY);
  logger.info('app', 'Logs cleared by user');
}

/**
 * Serialize logs for export (e.g. clipboard/share).
 * Produces human-readable text suitable for a bug report.
 */
export function exportLogs(): string {
  const entries = readEntries();
  const header = [
    '═══════════════════════════════════════════════',
    ' DAJAJ Finance — Application Log Export',
    ` Exported: ${new Date().toISOString()}`,
    ` App Version: ${APP_VERSION}`,
    ` Environment: ${ENVIRONMENT}`,
    ` Platform: ${Platform.OS}`,
    `═══════════════════════════════════════════════`,
    '',
  ].join('\n');

  const body = entries.map(e => {
    const data = e.data && Object.keys(e.data).length > 0
      ? `\n  ${JSON.stringify(e.data, null, 2).split('\n').join('\n  ')}`
      : '';
    return `[${e.timestamp}] [${e.level}] [${e.category}] ${e.message}${data}`;
  }).join('\n');

  return header + body;
}
