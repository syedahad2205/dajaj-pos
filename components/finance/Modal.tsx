"use client";

import type { ReactNode } from "react";

interface ModalProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  maxWidthClassName?: string;
}

export default function Modal({ title, subtitle, onClose, children, maxWidthClassName = "max-w-lg" }: ModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:px-4 sm:py-8">
      <div
        className={`flex max-h-[92vh] w-full ${maxWidthClassName} flex-col overflow-hidden rounded-t-[28px] bg-white shadow-xl sm:max-h-[90vh] sm:rounded-[28px]`}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex flex-shrink-0 justify-center pt-2.5 sm:hidden">
          <span className="h-1.5 w-10 rounded-full bg-slate-200" />
        </div>
        <div className="flex flex-shrink-0 items-start justify-between gap-4 border-b border-slate-100 p-5 sm:p-6">
          <div>
            <h2 className="text-lg font-black text-slate-900 sm:text-xl">{title}</h2>
            {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-2xl leading-none text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 sm:p-6">{children}</div>
      </div>
    </div>
  );
}
