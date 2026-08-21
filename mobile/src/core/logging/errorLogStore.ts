/**
 * Local-only error log (design §13a, Requirement 17).
 *
 * MMKV-backed, capped at MAX_ENTRIES with oldest-first eviction.
 * No network calls — purely local diagnostics.
 * Never stores usernames, passwords, tokens, or full Firestore document bodies (Requirement 17.4).
 *
 * NOTE: All entries written here are also forwarded to the centralized logger
 * (core/logging/logger.ts) so that errors appear in the unified log viewer.
 * The MMKV store here is kept for backwards compatibility and as a secondary
 * dedicated error-only store.
 */
import { MMKV } from 'react-native-mmkv';

const storage = new MMKV({ id: 'dajaj-finance-error-log' });
const LOG_KEY = 'error_log';
const MAX_ENTRIES = 200; // Requirement 17.2: bounded size, oldest-first eviction

export interface LocalErrorLogEntry {
  timestamp: string;   // ISO 8601
  screen: string;      // route name active at error time
  operation: string | null;
  message: string;
  stack?: string;
}

function readLog(): LocalErrorLogEntry[] {
  const raw = storage.getString(LOG_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw) as LocalErrorLogEntry[]; } catch { return []; }
}

function writeLog(entries: LocalErrorLogEntry[]): void {
  storage.set(LOG_KEY, JSON.stringify(entries));
}

/** Append an error entry, evicting the oldest if over the cap. */
export function logError(entry: Omit<LocalErrorLogEntry, 'timestamp'>): void {
  const entries = readLog();
  entries.push({ ...entry, timestamp: new Date().toISOString() });
  // Oldest-first eviction (Requirement 17.2)
  const trimmed = entries.length > MAX_ENTRIES ? entries.slice(entries.length - MAX_ENTRIES) : entries;
  writeLog(trimmed);

  // Forward to the centralized logger — lazy import to avoid circular deps at module load
  setImmediate(() => {
    try {
       
      const { logger } = require('@/core/logging/logger') as { logger: { exception: (screen: string, op: string | null, err: unknown, ctx?: Record<string, unknown>) => void } };
      logger.exception(entry.screen, entry.operation, { message: entry.message, stack: entry.stack });
    } catch {
      // Never let logger failure affect error handling
    }
  });
}

/** Read all logged entries (for Settings Diagnostics). */
export function getErrorLog(): LocalErrorLogEntry[] {
  return readLog();
}

/** Serialize the log to a string suitable for copying to clipboard. */
export function serializeErrorLog(): string {
  return readLog().map(e =>
    `[${e.timestamp}] ${e.screen}${e.operation ? ` / ${e.operation}` : ''}\n${e.message}${e.stack ? `\n${e.stack}` : ''}`
  ).join('\n\n---\n\n');
}

/** Clear the error log (called on logout). */
export function clearErrorLog(): void {
  storage.delete(LOG_KEY);
}

/**
 * Install a global unhandled-promise-rejection handler (Requirement 17.1, design §13a).
 * Call once from App.tsx before rendering. Captures unexpected async failures
 * that slip past explicit try/catch blocks.
 *
 * Does NOT capture: normal validation errors, expected API failures handled
 * by mutation hooks — only unexpected/unrecoverable conditions.
 */
export function installGlobalErrorHandlers(): void {
  // React Native exposes this via the global ErrorUtils object
  const errorUtils = (globalThis as Record<string, unknown>).ErrorUtils as {
    setGlobalHandler?: (handler: (error: Error, isFatal?: boolean) => void) => void;
    getGlobalHandler?: () => ((error: Error, isFatal?: boolean) => void) | null;
  } | undefined;

  if (errorUtils?.setGlobalHandler) {
    errorUtils.setGlobalHandler((error, isFatal) => {
      // Log to local store — never network-transmit (Requirement 17.3)
      logError({
        screen: 'global',
        operation: isFatal ? 'fatal' : 'unhandled',
        message: error?.message ?? String(error),
        stack: error?.stack,
      });
      // Preserve original handler behavior (crash reporting etc.)
      const orig = errorUtils.getGlobalHandler?.();
      if (typeof orig === 'function') orig(error, isFatal);
    });
  }
}
