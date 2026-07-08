/**
 * Display-only date utilities.
 * toDateKey() uses LOCAL time (matching lib/finance.ts in the web app) so date
 * keys are consistent with the timezone the restaurant operates in.
 * Set the device timezone to the restaurant's timezone for correct behavior.
 */
import { format, startOfMonth } from 'date-fns';

/**
 * YYYY-MM-DD for the given date using LOCAL time.
 * Mirrors lib/finance.ts toDateKey() exactly — uses getFullYear/getMonth/getDate
 * (not UTC equivalents) so the date key reflects the restaurant's local time.
 */
export function toDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Display-friendly date string, e.g. "Monday, 7 July 2025" */
export function formatDateDisplay(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(`${date}T00:00:00`) : date;
  return format(d, 'EEEE, d MMMM yyyy');
}

/** First day of the current month as a date key. */
export function startOfMonthKey(date: Date = new Date()): string {
  return toDateKey(startOfMonth(date));
}

/** Format an ISO closing timestamp, e.g. "14:32 · 7 Jul 2025" */
export function formatClosingTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return format(new Date(iso), "HH:mm · d MMM yyyy");
  } catch {
    return iso;
  }
}
