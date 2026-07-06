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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-8">
      <div className={`flex max-h-[90vh] w-full ${maxWidthClassName} flex-col overflow-hidden rounded-[28px] bg-white shadow-xl`}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-6">
          <div>
            <h2 className="text-xl font-black text-slate-900">{title}</h2>
            {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-2xl leading-none text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}
