"use client";

import { Calendar } from "lucide-react";
import type { InputHTMLAttributes } from "react";

interface NativeDateFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "type"> {
  value: string;
  /** Extra classes merged onto the *visible* box (size/etc. overrides). */
  className?: string;
}

function formatDateDisplay(dateKey: string): string {
  if (!dateKey) return "Select date";
  const d = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "Select date";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * An <input type="date"> that never lets the browser draw its own control.
 *
 * iOS Safari renders type="date" as its own grey "capsule" native picker
 * button — no CSS override reliably beats that; Apple deliberately locks
 * its visual style. The only fix that's pixel-identical on every browser is
 * the same trick as NativeSelectField: keep the real input fully
 * transparent on top (so tapping it still opens the native date-wheel and
 * still fires onChange with the right value) while a plain styled <div>
 * underneath is 100% what's actually visible.
 */
export default function NativeDateField({ value, className = "", disabled, ...inputProps }: NativeDateFieldProps) {
  return (
    <div className="relative">
      <input
        {...inputProps}
        type="date"
        value={value}
        disabled={disabled}
        className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
      <div
        className={`flex w-full items-center justify-between gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 peer-focus:border-orange-400 peer-focus:ring-2 peer-focus:ring-orange-100 peer-disabled:bg-slate-50 peer-disabled:text-slate-400 ${className}`}
      >
        <span className="truncate">{formatDateDisplay(value)}</span>
        <Calendar size={15} className="flex-shrink-0 text-slate-400" />
      </div>
    </div>
  );
}
