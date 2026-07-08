/**
 * Display-only date/currency formatting helpers (design §3 — core/format/financeFormat.ts).
 *
 * These are pure UI/presentation concerns — NOT finance calculations.
 * No business logic. No rounding replication. No formula code.
 *
 * Mirrors the intent of lib/financeFormat.ts in the web project for date display,
 * using date-fns for React Native (same library, same import style).
 */
import { format, isToday, isYesterday } from 'date-fns';

/**
 * Format a currency value for display (e.g. "₹1,234.56").
 * Returns "—" for null/undefined — never returns "0" for null (Requirement 6.4).
 */
export function formatCurrency(value: number | null | undefined): string {
  if (value == null) return '—';
  return `₹${value.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Format a YYYY-MM-DD date key for display, e.g. "Monday, 7 July 2025".
 * Uses date-fns for consistent locale-agnostic formatting.
 */
export function formatDateDisplay(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00`);
  if (isToday(d)) return `Today · ${format(d, 'd MMMM yyyy')}`;
  if (isYesterday(d)) return `Yesterday · ${format(d, 'd MMMM yyyy')}`;
  return format(d, 'EEEE, d MMMM yyyy');
}

/**
 * Format a YYYY-MM-DD date key as a short date, e.g. "7 Jul".
 */
export function formatDateShort(dateKey: string): string {
  return format(new Date(`${dateKey}T00:00:00`), 'd MMM');
}

/**
 * Format an ISO timestamp string (closingTime) for display, e.g. "14:32 on 7 Jul 2025".
 */
export function formatClosingTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return format(new Date(iso), 'HH:mm \'on\' d MMM yyyy');
  } catch {
    return iso;
  }
}
