"use client";

import { ChevronDown } from "lucide-react";
import type { ReactNode, SelectHTMLAttributes } from "react";

interface NativeSelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "className"> {
  /** What the visible box shows — usually the selected option's label, or a placeholder string. */
  displayValue: ReactNode;
  /** Renders displayValue in muted placeholder styling instead of normal text. */
  placeholder?: boolean;
  /** Extra classes merged onto the *visible* box (radius/size/etc. overrides). The real <select> always fills its wrapper exactly. */
  className?: string;
  children: ReactNode;
}

/**
 * A <select> that never lets the browser draw its own control chrome.
 *
 * Plain <select appearance-none> still isn't reliably enough on iOS Safari —
 * some iOS versions keep painting their own grey "capsule" background/shape
 * underneath regardless of appearance/background/border-radius overrides.
 * The only rendering that's guaranteed pixel-identical on every browser is
 * one that never lets the browser draw anything visible at all: the real
 * <select> sits fully transparent on top (so it still gets every tap, still
 * opens the native option sheet, still submits the right value) while a
 * plain styled <div> underneath is 100% what the user actually sees.
 */
export default function NativeSelectField({
  displayValue,
  placeholder,
  className = "",
  children,
  disabled,
  ...selectProps
}: NativeSelectFieldProps) {
  return (
    <div className="relative">
      <select
        {...selectProps}
        disabled={disabled}
        className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      >
        {children}
      </select>
      <div
        className={`flex w-full items-center justify-between gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 peer-focus:border-orange-400 peer-focus:ring-2 peer-focus:ring-orange-100 peer-disabled:bg-slate-50 peer-disabled:text-slate-400 ${className}`}
      >
        <span className={`truncate ${placeholder ? "text-slate-400" : ""}`}>{displayValue}</span>
        <ChevronDown size={16} className="flex-shrink-0 text-slate-400" strokeWidth={2.5} />
      </div>
    </div>
  );
}
